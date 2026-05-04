// Pull-quality audit. Read-only. Prints a markdown report to stdout.
//
//   npm run audit:quality
//
// Inspects the live DB and surfaces:
//   - per-source meeting and item counts (YTD)
//   - empty-meeting rates (past vs upcoming)
//   - extraction-field fill rates (matter_file_number, comment_*, addresses)
//   - geocoding success rate
//   - recent scrape_runs errors
//   - pre-2026-05-02 BOS committee meetings (Legistar minutes backfill candidates)

import { createAdminClient } from '@/lib/supabase/admin.ts';

type Meeting = {
  id: string;
  source_id: string;
  meeting_date: string;
  needs_ocr: boolean;
  scraped_at: string;
};

type Item = {
  id: string;
  meeting_id: string;
  matter_file_number: string | null;
  comment_deadline: string | null;
  comment_email: string | null;
  comment_portal_url: string | null;
  in_person_slot: string | null;
};

type Loc = { agenda_item_id: string; lat: number | null };

type Run = {
  source_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_found: number | null;
  items_new: number | null;
  error: string | null;
};

const BOS_COMMITTEES = new Set([
  'bos-land-use',
  'bos-budget',
  'bos-rules',
  'bos-public-safety',
  'bos-gao',
]);
const LEGISTAR_FIX_DATE = '2026-05-02';

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;
}

function row(cells: (string | number)[]) {
  return `| ${cells.join(' | ')} |`;
}

async function main() {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const ytdStart = `${new Date().getFullYear()}-01-01`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [meetingsRes, itemsRes, locsRes, runsRes] = await Promise.all([
    db.from('meetings')
      .select('id, source_id, meeting_date, needs_ocr, scraped_at')
      .gte('meeting_date', ytdStart)
      .limit(20000) as Promise<{ data: Meeting[] | null; error: unknown }>,
    db.from('agenda_items')
      .select('id, meeting_id, matter_file_number, comment_deadline, comment_email, comment_portal_url, in_person_slot, meetings!inner(source_id, meeting_date)')
      .gte('meetings.meeting_date', ytdStart)
      .limit(50000) as Promise<{ data: (Item & { meetings: { source_id: string; meeting_date: string } })[] | null; error: unknown }>,
    db.from('agenda_item_locations')
      .select('agenda_item_id, lat')
      .limit(50000) as Promise<{ data: Loc[] | null; error: unknown }>,
    db.from('scrape_runs')
      .select('source_id, status, started_at, finished_at, items_found, items_new, error')
      .order('started_at', { ascending: false })
      .limit(500) as Promise<{ data: Run[] | null; error: unknown }>,
  ]);

  for (const [name, res] of Object.entries({ meetings: meetingsRes, items: itemsRes, locs: locsRes, runs: runsRes })) {
    if (res.error) {
      console.error(`Failed to load ${name}:`, res.error);
      process.exit(1);
    }
  }

  const meetings = meetingsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const locs = locsRes.data ?? [];
  const runs = runsRes.data ?? [];

  // Items grouped by meeting_id and source_id
  const itemsByMeeting = new Map<string, Item[]>();
  for (const item of items) {
    const arr = itemsByMeeting.get(item.meeting_id) ?? [];
    arr.push(item);
    itemsByMeeting.set(item.meeting_id, arr);
  }

  const geocodedItemIds = new Set(locs.filter((l) => l.lat != null).map((l) => l.agenda_item_id));

  const sources = [...new Set(meetings.map((m) => m.source_id))].sort();

  console.log(`# Pull Quality Audit — ${today}\n`);
  console.log(`Year-to-date window: \`${ytdStart}\` → \`${today}\`\n`);

  // ── Per-source meeting + item summary ─────────────────────────────────────
  console.log('## Per-source coverage (YTD)\n');
  console.log(row(['source', 'meetings', 'past', 'upcoming', 'empty (past)', 'empty (upcoming)', 'needs_ocr', 'avg items / non-empty mtg']));
  console.log(row(['---', '---', '---', '---', '---', '---', '---', '---']));

  for (const src of sources) {
    const srcMeetings = meetings.filter((m) => m.source_id === src);
    const past = srcMeetings.filter((m) => m.meeting_date < today);
    const upcoming = srcMeetings.filter((m) => m.meeting_date >= today);
    const emptyPast = past.filter((m) => (itemsByMeeting.get(m.id) ?? []).length === 0);
    const emptyUpcoming = upcoming.filter((m) => (itemsByMeeting.get(m.id) ?? []).length === 0);
    const needsOcr = srcMeetings.filter((m) => m.needs_ocr);
    const nonEmpty = srcMeetings.filter((m) => (itemsByMeeting.get(m.id) ?? []).length > 0);
    const itemTotal = nonEmpty.reduce((acc, m) => acc + (itemsByMeeting.get(m.id) ?? []).length, 0);
    const avg = nonEmpty.length === 0 ? '—' : (itemTotal / nonEmpty.length).toFixed(1);
    console.log(row([
      src,
      srcMeetings.length,
      past.length,
      upcoming.length,
      `${emptyPast.length} (${pct(emptyPast.length, past.length)})`,
      `${emptyUpcoming.length} (${pct(emptyUpcoming.length, upcoming.length)})`,
      needsOcr.length,
      avg,
    ]));
  }

  // ── Extraction field fill rates ───────────────────────────────────────────
  console.log('\n## Extraction field fill rates (per source, items YTD)\n');
  console.log(row(['source', 'items', 'matter_file_number', 'comment_deadline', 'comment_email', 'comment_portal_url', 'in_person_slot', 'geocoded ≥1 addr']));
  console.log(row(['---', '---', '---', '---', '---', '---', '---', '---']));

  for (const src of sources) {
    const srcItems = items.filter((i) => i.meetings.source_id === src);
    if (srcItems.length === 0) continue;
    const wMatter = srcItems.filter((i) => i.matter_file_number != null).length;
    const wDeadline = srcItems.filter((i) => i.comment_deadline != null).length;
    const wEmail = srcItems.filter((i) => i.comment_email != null).length;
    const wPortal = srcItems.filter((i) => i.comment_portal_url != null).length;
    const wInPerson = srcItems.filter((i) => i.in_person_slot != null).length;
    const wGeo = srcItems.filter((i) => geocodedItemIds.has(i.id)).length;
    console.log(row([
      src,
      srcItems.length,
      `${pct(wMatter, srcItems.length)} (${wMatter})`,
      `${pct(wDeadline, srcItems.length)} (${wDeadline})`,
      `${pct(wEmail, srcItems.length)} (${wEmail})`,
      `${pct(wPortal, srcItems.length)} (${wPortal})`,
      `${pct(wInPerson, srcItems.length)} (${wInPerson})`,
      `${pct(wGeo, srcItems.length)} (${wGeo})`,
    ]));
  }

  // BOS sources are expected to have ~100% matter_file_number; flag anomalies
  console.log('\n> **Expectation:** BOS-family sources should have near-100% matter_file_number coverage. Lower numbers mean the LLM is missing file-number extraction or agendas don\'t print them.');

  // ── Recent scrape_runs status ─────────────────────────────────────────────
  console.log('\n## Most recent scrape_runs (per source)\n');
  console.log(row(['source', 'started', 'status', 'items_found', 'items_new', 'error (truncated)']));
  console.log(row(['---', '---', '---', '---', '---', '---']));
  const runSources = [...new Set(runs.map((r) => r.source_id))].sort();
  for (const src of runSources) {
    const last = runs.find((r) => r.source_id === src);
    if (!last) continue;
    const errStr = last.error ? last.error.slice(0, 80).replace(/[|\n\r]/g, ' ') : '';
    console.log(row([
      src,
      last.started_at.slice(0, 16).replace('T', ' '),
      last.status,
      last.items_found ?? 0,
      last.items_new ?? 0,
      errStr,
    ]));
  }

  // ── Recent errors (last 30 days) ──────────────────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const recentErrors = runs.filter((r) => r.status === 'error' && r.started_at >= thirtyDaysAgo);
  console.log(`\n## Errors in last 30 days: ${recentErrors.length}\n`);
  if (recentErrors.length > 0) {
    console.log(row(['source', 'started', 'error (truncated)']));
    console.log(row(['---', '---', '---']));
    for (const r of recentErrors.slice(0, 20)) {
      const errStr = (r.error ?? '').slice(0, 120).replace(/[|\n\r]/g, ' ');
      console.log(row([r.source_id, r.started_at.slice(0, 16).replace('T', ' '), errStr]));
    }
  }

  // ── BOS minutes backfill candidates ───────────────────────────────────────
  // Per project memory: pre-2026-05-02 BOS committee meetings were scraped
  // before the View.ashx fix and may be missing minutes-derived items.
  // Heuristic: count past committee meetings scraped before that date.
  console.log('\n## BOS committee minutes backfill candidates\n');
  console.log(`Pre-fix date: \`${LEGISTAR_FIX_DATE}\` (Legistar View.ashx download fix).\n`);
  const candidates = meetings.filter(
    (m) =>
      BOS_COMMITTEES.has(m.source_id) &&
      m.meeting_date < today &&
      m.scraped_at.slice(0, 10) < LEGISTAR_FIX_DATE,
  );
  console.log(row(['source', 'pre-fix past meetings', 'with items', 'avg items / mtg']));
  console.log(row(['---', '---', '---', '---']));
  for (const src of [...BOS_COMMITTEES].sort()) {
    const c = candidates.filter((m) => m.source_id === src);
    const withItems = c.filter((m) => (itemsByMeeting.get(m.id) ?? []).length > 0);
    const itemTotal = c.reduce((acc, m) => acc + (itemsByMeeting.get(m.id) ?? []).length, 0);
    const avg = c.length === 0 ? '—' : (itemTotal / c.length).toFixed(1);
    console.log(row([src, c.length, withItems.length, avg]));
  }
  console.log(`\n**Total backfill candidates:** ${candidates.length} meetings.`);
  console.log('Lower-than-typical avg items / mtg vs the per-source coverage table above suggests minutes-derived items are missing. If avg is roughly the same, no backfill needed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
