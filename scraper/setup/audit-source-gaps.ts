// Source gap audit. Read-only. Prints a markdown report to stdout.
//
//   npx tsx scraper/setup/audit-source-gaps.ts
//
// Surfaces three categories of meetings that are scraped but produce no items:
//   1. needs_ocr=true  — text too short (<200 chars); LLM skipped entirely
//   2. zero-item       — needs_ocr=false but 0 agenda_items joined
//   3. text truncation — collected text exceeded MAX_TEXT_TOTAL before LLM cap
//      (requires migration 0007 to add text_length column; shows N/A until then)

import { createAdminClient } from '@/lib/supabase/admin.ts';

type MeetingRow = {
  id: string;
  source_id: string;
  meeting_date: string;
  needs_ocr: boolean;
  external_id: string | null;
  text_length: number | null;
};

type ItemRow = { meeting_id: string };

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;
}

function row(cells: (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

async function main() {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const today = new Date().toISOString().slice(0, 10);

  console.log(`# Source Gap Audit — ${today}\n`);
  console.log('Covers all stored meetings (not limited to YTD).\n');

  // Load all meetings (no date filter — want full historical picture).
  // Try including text_length (migration 0007); fall back without it if the
  // column doesn't exist yet so the script works pre-migration.
  let meetings: MeetingRow[] | null = null;
  {
    const withLen = await db
      .from('meetings')
      .select('id, source_id, meeting_date, needs_ocr, external_id, text_length')
      .order('meeting_date', { ascending: false })
      .limit(50000) as { data: MeetingRow[] | null; error: { code?: string } | null };

    if (withLen.error?.code === '42703') {
      // Column not yet present — run without it
      const withoutLen = await db
        .from('meetings')
        .select('id, source_id, meeting_date, needs_ocr, external_id')
        .order('meeting_date', { ascending: false })
        .limit(50000) as { data: Omit<MeetingRow, 'text_length'>[] | null; error: unknown };
      if (withoutLen.error || !withoutLen.data) {
        console.error('Failed to load meetings:', withoutLen.error);
        process.exit(1);
      }
      meetings = withoutLen.data.map((m) => ({ ...m, text_length: null }));
    } else if (withLen.error || !withLen.data) {
      console.error('Failed to load meetings:', withLen.error);
      process.exit(1);
    } else {
      meetings = withLen.data;
    }
  }

  // Load only the meeting_id from agenda_items so we can compute zero-item sets
  const { data: items, error: iErr } = await db
    .from('agenda_items')
    .select('meeting_id')
    .limit(200000) as { data: ItemRow[] | null; error: unknown };

  if (iErr || !items) {
    console.error('Failed to load agenda_items:', iErr);
    process.exit(1);
  }

  const meetingsWithItems = new Set(items.map((i) => i.meeting_id));
  const sources = [...new Set(meetings.map((m) => m.source_id))].sort();
  const textLengthAvailable = meetings.some((m) => m.text_length != null);

  // ── Per-source gap summary ─────────────────────────────────────────────────
  console.log('## Per-source gap summary (all time)\n');
  console.log(row(['source', 'total meetings', 'needs_ocr', 'zero-item (excl OCR)', 'dark meetings', 'coverage']));
  console.log(row(['---', '---', '---', '---', '---', '---']));

  let grandTotal = 0;
  let grandDark = 0;

  for (const src of sources) {
    const all = meetings.filter((m) => m.source_id === src);
    const ocrFlagged = all.filter((m) => m.needs_ocr);
    // Zero-item: scrape succeeded (not flagged OCR) but LLM found nothing
    const extractable = all.filter((m) => !m.needs_ocr);
    const zeroItem = extractable.filter((m) => !meetingsWithItems.has(m.id));
    // "Dark" = total meetings with no items for any reason
    const dark = all.filter((m) => !meetingsWithItems.has(m.id));
    grandTotal += all.length;
    grandDark += dark.length;

    console.log(row([
      src,
      all.length,
      `${ocrFlagged.length} (${pct(ocrFlagged.length, all.length)})`,
      `${zeroItem.length} (${pct(zeroItem.length, extractable.length)})`,
      dark.length,
      pct(all.length - dark.length, all.length),
    ]));
  }
  console.log(row(['**TOTAL**', grandTotal, '—', '—', grandDark, pct(grandTotal - grandDark, grandTotal)]));

  // ── OCR-flagged details ────────────────────────────────────────────────────
  console.log('\n## needs_ocr=true detail (oldest → newest per source)\n');
  console.log('These meetings have <200 chars of extracted text; LLM extraction was skipped entirely.\n');
  console.log(row(['source', 'date', 'external_id']));
  console.log(row(['---', '---', '---']));

  for (const src of sources) {
    const flagged = meetings
      .filter((m) => m.source_id === src && m.needs_ocr)
      .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
    for (const m of flagged) {
      console.log(row([src, m.meeting_date, m.external_id ?? '—']));
    }
  }
  if (meetings.every((m) => !m.needs_ocr)) {
    console.log('_(none found — all meetings have sufficient extracted text)_');
  }

  // ── Zero-item meetings (not OCR-flagged) ──────────────────────────────────
  console.log('\n## Zero-item meetings with extractable text (sample, up to 10 per source)\n');
  console.log('needs_ocr=false but 0 agenda_items. Possible causes: genuine empty agenda,\n');
  console.log('LLM found no items in the text, or PDF parse returned text but not agenda items.\n');
  console.log(row(['source', 'date', 'external_id']));
  console.log(row(['---', '---', '---']));

  for (const src of sources) {
    const zeroItem = meetings
      .filter((m) => m.source_id === src && !m.needs_ocr && !meetingsWithItems.has(m.id))
      .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))
      .slice(0, 10);
    for (const m of zeroItem) {
      console.log(row([src, m.meeting_date, m.external_id ?? '—']));
    }
  }

  // ── Text truncation ────────────────────────────────────────────────────────
  console.log('\n## Text truncation (collected > LLM cap)\n');

  if (!textLengthAvailable) {
    console.log('> **text_length column not yet present.** Apply migration 0007 and re-run');
    console.log('> scrapers to populate. Once available, this section will show how many');
    console.log('> meetings had collected text exceeding MAX_TEXT_LENGTH (100k after this fix).');
  } else {
    // MAX_TEXT_TOTAL per scraper is 100k–120k; LLM cap is 100k after the fix.
    // Flag meetings where collected text exceeded 100k.
    const LLM_CAP = 100_000;
    console.log(row(['source', 'total with text_length', 'truncated at LLM cap (>100k)', 'truncated %']));
    console.log(row(['---', '---', '---', '---']));
    for (const src of sources) {
      const withLen = meetings.filter((m) => m.source_id === src && m.text_length != null);
      const truncated = withLen.filter((m) => (m.text_length ?? 0) > LLM_CAP);
      if (withLen.length === 0) continue;
      console.log(row([src, withLen.length, truncated.length, pct(truncated.length, withLen.length)]));
    }
  }

  // ── Oldest meeting per source ──────────────────────────────────────────────
  console.log('\n## Oldest stored meeting per source\n');
  console.log('If the oldest date seems too recent, pagination may be cutting off earlier meetings.\n');
  console.log(row(['source', 'oldest meeting_date', 'newest meeting_date', 'total']));
  console.log(row(['---', '---', '---', '---']));
  for (const src of sources) {
    const all = meetings.filter((m) => m.source_id === src);
    if (all.length === 0) continue;
    const sorted = [...all].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
    console.log(row([src, sorted[0].meeting_date, sorted[sorted.length - 1].meeting_date, all.length]));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
