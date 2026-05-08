// Backfill BOS-family meetings whose pre-fix rows are missing minutes text.
//
// Memory note (M15 prerequisite): "Pre-fix DB rows missing minutes text;
// backfill needed before M15 accountability work."
//
// Targets every meeting in the BOS family (`bos`, `bos-land-use`, `bos-budget`,
// `bos-rules`, `bos-public-safety`, `bos-gao`) whose meeting_date is in the
// past, irrespective of extraction_status. Re-walks the event page, fetches
// AGENDA + MINUTES (+ multimodal fallback for scanned minutes PDFs), and
// re-extracts via the shared pipeline.
//
// Usage:
//   npm run backfill:bos-minutes                       # all eligible
//   npm run backfill:bos-minutes -- --limit 25         # smoke test
//   npm run backfill:bos-minutes -- --source bos-budget  # one committee

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { htmlToText } from '../lib/llm.ts';
import {
  persistExtractedItems,
  type GatherStats,
} from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const BOS_SOURCES = [
  'bos',
  'bos-land-use',
  'bos-budget',
  'bos-rules',
  'bos-public-safety',
  'bos-gao',
];

const MAX_PDFS = 12;
const MAX_TEXT_PER_PDF = 100_000;
const MAX_TEXT_PER_RESOURCE = 400_000;
const MAX_TEXT_TOTAL = 500_000;

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function gatherFromUrl(
  page: Page,
  url: string,
  maxChars: number,
  stats: GatherStats,
): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf') || url.includes('View.ashx')) {
    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + 1;
    const r = await fetchBytes(url);
    if (!r.ok) {
      stats.fetchWarnings!.push(`${url}: ${r.message}`);
      return '';
    }
    stats.fetchedPdfCount = (stats.fetchedPdfCount ?? 0) + 1;
    const parsed = await extractPdfText(r.bytes);
    if (parsed.needsOcr || !parsed.text) {
      const label = url.split('/').pop() ?? url;
      stats.scannedPdfs!.push({ label, bytes: r.bytes });
      stats.fetchWarnings!.push(`${url}: scanned/OCR-only PDF`);
    }
    return parsed.text.slice(0, maxChars);
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    const parts: string[] = [htmlToText(html)];
    let total = parts[0].length;

    const pdfLinks = await page.evaluate((): string[] =>
      [
        ...new Set(
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.toLowerCase().endsWith('.pdf') || h.includes('View.ashx')),
        ),
      ],
    );

    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + pdfLinks.length;

    for (const pdfUrl of pdfLinks.slice(0, MAX_PDFS)) {
      if (total >= maxChars) break;
      const r = await fetchBytes(pdfUrl);
      if (!r.ok) {
        stats.fetchWarnings!.push(`${pdfUrl}: ${r.message}`);
        continue;
      }
      stats.fetchedPdfCount = (stats.fetchedPdfCount ?? 0) + 1;
      const parsed = await extractPdfText(r.bytes);
      if (parsed.needsOcr || !parsed.text) {
        const label = pdfUrl.split('/').pop() ?? pdfUrl;
        stats.scannedPdfs!.push({ label, bytes: r.bytes });
        stats.fetchWarnings!.push(`${pdfUrl}: scanned/OCR-only PDF`);
      }
      if (parsed.text) {
        const label = pdfUrl.split('/').pop() ?? pdfUrl;
        const block = `\n--- ${label} ---\n${parsed.text.slice(0, MAX_TEXT_PER_PDF)}`;
        parts.push(block);
        total += block.length;
      }
    }

    return parts.join('\n').slice(0, maxChars);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fetchWarnings!.push(`${url}: ${msg}`);
    return '';
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? (argv[idx + 1] ?? null) : null;
  };
  const limit = Number(get('--limit') ?? 'Infinity') || Infinity;
  const sourceArg = get('--source');
  const sources = sourceArg ? [sourceArg] : BOS_SOURCES;

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from('meetings')
    .select('id, source_id, title, meeting_date, agenda_url')
    .in('source_id', sources)
    .lt('meeting_date', today)
    .order('meeting_date', { ascending: false });

  if (error) throw error;

  console.log(`[backfill-bos-minutes] ${rows?.length ?? 0} past BOS meeting(s) eligible`);
  const targets = (rows ?? []).slice(0, Math.min(rows?.length ?? 0, limit));
  if (targets.length === 0) return;

  const ctx = await newContext();
  const page = await ctx.newPage();

  let okCount = 0;
  for (const m of targets) {
    console.log(`\n[backfill-bos-minutes] ${m.source_id} | ${m.meeting_date} | ${m.title}`);
    if (!m.agenda_url) {
      console.warn(`[backfill-bos-minutes]   no agenda_url, skipping`);
      continue;
    }

    try {
      await page.goto(m.agenda_url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      console.warn(`[backfill-bos-minutes]   nav failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    const links = await page.evaluate((): { agenda: string | null; minutes: string | null } => {
      const out = { agenda: null as string | null, minutes: null as string | null };
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).href;
        const text = (a.textContent ?? '').toLowerCase();
        if (!out.agenda && text.includes('agenda') && !text.includes('minutes')) out.agenda = href;
        if (!out.minutes && text.includes('minutes')) out.minutes = href;
      }
      return out;
    });

    if (!links.minutes) {
      console.log(`[backfill-bos-minutes]   no minutes link, skipping`);
      continue;
    }

    const stats: GatherStats = {
      scannedPdfs: [],
      fetchWarnings: [],
      expectedPdfCount: 0,
      fetchedPdfCount: 0,
    };

    let agendaText = '';
    if (links.agenda) {
      agendaText += await gatherFromUrl(page, links.agenda, MAX_TEXT_PER_RESOURCE, stats);
    }
    if (agendaText.length < MAX_TEXT_TOTAL) {
      const remaining = MAX_TEXT_TOTAL - agendaText.length;
      const t = await gatherFromUrl(
        page,
        links.minutes,
        Math.min(MAX_TEXT_PER_RESOURCE, remaining),
        stats,
      );
      if (t) agendaText += `\n\n======== MINUTES ========\n\n${t}`;
    }

    agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
    if (agendaText.trim().length < 200 && stats.scannedPdfs!.length === 0) {
      console.warn(`[backfill-bos-minutes]   no usable content`);
      continue;
    }

    console.log(`[backfill-bos-minutes]   gathered ${agendaText.length} chars + ${stats.scannedPdfs!.length} scanned PDF(s)`);
    try {
      await persistExtractedItems(supabase, m.id, m.title, agendaText, stats);
      okCount++;
    } catch (err) {
      console.error(`[backfill-bos-minutes]   pipeline failed:`, err instanceof Error ? err.message : err);
    }

    // Polite throttle between meetings.
    await new Promise((r) => setTimeout(r, 1000));
  }

  await ctx.close();
  console.log(`\n[backfill-bos-minutes] done — ${okCount}/${targets.length} processed`);
  // normalizeName is defined for callers that may want pattern matching on
  // committee names; keep the export shape stable.
  void normalizeName;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
