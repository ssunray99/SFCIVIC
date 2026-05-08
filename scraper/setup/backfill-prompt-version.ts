// Generic prompt-version / extraction-status backfill.
//
// Walks meetings whose extraction is stale or never succeeded under the
// current PROMPT_VERSION, re-fetches the event page, re-gathers PDFs (with
// the new structured fetchBytes + scanned-PDF detection), and re-runs the
// extraction pipeline. The pipeline handles status writes + multimodal
// fallback.
//
// Replaces the per-source backfill-planning.ts and backfill-bos-committees.ts
// scripts. Those still work for legacy targeted runs but this is the path
// going forward.
//
// Usage:
//   npm run backfill:prompt-version                       # all eligible
//   npm run backfill:prompt-version -- --limit 50         # 50 oldest
//   npm run backfill:prompt-version -- --source planning  # one source
//   npm run backfill:prompt-version -- --status failed    # only retry failures
//
// Polite throttle: defaults to 1 meeting/sec to avoid hammering source sites.
//   --rate 0.5  → 1 meeting per 2 seconds
//   --rate 2    → 2 meetings per second

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
import { PROMPT_VERSION } from '../prompts/extract.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const MAX_PDFS = 12;
const MAX_TEXT_PER_PDF = 100_000;
const MAX_TEXT_PER_RESOURCE = 400_000;
const MAX_TEXT_TOTAL = 500_000;

type Args = {
  limit: number;
  source: string | null;
  status: string | null;
  rate: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? (argv[idx + 1] ?? null) : null;
  };
  return {
    limit: Number(get('--limit') ?? 'Infinity') || Infinity,
    source: get('--source'),
    status: get('--status'),
    rate: Number(get('--rate') ?? '1'),
  };
}

async function gatherFromUrl(
  page: Page,
  url: string,
  maxChars: number,
  stats: GatherStats,
  log: string,
): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf') || url.includes('View.ashx')) {
    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + 1;
    const r = await fetchBytes(url);
    if (!r.ok) {
      stats.fetchWarnings!.push(`${url}: ${r.message}`);
      console.warn(`${log} PDF fetch failed ${url}: ${r.message}`);
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
    console.warn(`${log} page fetch failed ${url}: ${msg}`);
    return '';
  }
}

async function findAgendaAndMinutes(
  page: Page,
): Promise<{ agenda: string | null; minutes: string | null; supporting: string | null }> {
  return page.evaluate((): {
    agenda: string | null;
    minutes: string | null;
    supporting: string | null;
  } => {
    const out = {
      agenda: null as string | null,
      minutes: null as string | null,
      supporting: null as string | null,
    };
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = (a as HTMLAnchorElement).href;
      const text = (a.textContent ?? '').trim().toLowerCase();
      if (!href || /INSERTLINK/i.test(href)) continue;
      if (!out.agenda && /^agenda(\s*\(?pdf\)?)?$/i.test(text)) out.agenda = href;
      else if (!out.minutes && /^minutes(\s*\(?pdf\)?)?$/i.test(text)) out.minutes = href;
      else if (!out.supporting && /^supporting(\s*\(?pdf\)?)?$/i.test(text)) out.supporting = href;
      // sf.gov BOS uses "agenda" / "minutes" inside link text rather than as
      // exact match.
      if (!out.agenda && text.includes('agenda') && !text.includes('minutes')) out.agenda = href;
      if (!out.minutes && text.includes('minutes')) out.minutes = href;
    }
    return out;
  });
}

async function main() {
  const args = parseArgs();
  const supabase = createAdminClient();

  console.log(
    `[backfill] target version=${PROMPT_VERSION} ` +
    `limit=${args.limit} source=${args.source ?? 'any'} status=${args.status ?? 'any-stale'} ` +
    `rate=${args.rate}/sec`,
  );

  // Eligibility: extraction_status != 'success' OR last_prompt_version != current.
  let query = supabase
    .from('meetings')
    .select('id, source_id, title, meeting_date, agenda_url, extraction_status, last_prompt_version, extraction_attempt_count')
    .order('meeting_date', { ascending: false });

  if (args.source) query = query.eq('source_id', args.source);
  if (args.status) query = query.eq('extraction_status', args.status);

  const { data: rows, error } = await query;
  if (error) throw error;

  const candidates = (rows ?? []).filter(
    (r: { extraction_status: string; last_prompt_version: string | null }) =>
      r.extraction_status !== 'success' || r.last_prompt_version !== PROMPT_VERSION,
  );

  console.log(`[backfill] ${candidates.length} candidate(s); processing up to ${args.limit}`);

  const targets = candidates.slice(0, Math.min(candidates.length, args.limit));
  if (targets.length === 0) return;

  const ctx = await newContext();
  const page = await ctx.newPage();

  let okCount = 0;
  let failCount = 0;
  const delayMs = Math.max(0, Math.floor(1000 / args.rate));

  for (const m of targets) {
    const log = `[backfill:${m.source_id}]`;
    console.log(`\n${log} === ${m.meeting_date} | ${m.title} | status=${m.extraction_status} v=${m.last_prompt_version ?? '∅'}`);

    if (!m.agenda_url) {
      console.warn(`${log} no agenda_url, skipping`);
      continue;
    }

    try {
      await page.goto(m.agenda_url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${log} event page nav failed: ${msg}`);
      failCount++;
      continue;
    }

    const links = await findAgendaAndMinutes(page);
    console.log(`${log}   agenda=${links.agenda ?? '∅'} minutes=${links.minutes ?? '∅'} supporting=${links.supporting ?? '∅'}`);

    const today = new Date().toISOString().slice(0, 10);
    const isPast = m.meeting_date < today;

    const stats: GatherStats = {
      scannedPdfs: [],
      fetchWarnings: [],
      expectedPdfCount: 0,
      fetchedPdfCount: 0,
    };

    let agendaText = '';

    if (links.agenda) {
      agendaText += await gatherFromUrl(page, links.agenda, MAX_TEXT_PER_RESOURCE, stats, log);
    }
    if (isPast && links.minutes && agendaText.length < MAX_TEXT_TOTAL) {
      const text = await gatherFromUrl(
        page,
        links.minutes,
        Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
        stats,
        log,
      );
      if (text) agendaText += `\n\n======== MINUTES ========\n\n${text}`;
    }
    if (isPast && links.supporting && agendaText.length < MAX_TEXT_TOTAL) {
      const text = await gatherFromUrl(
        page,
        links.supporting,
        Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
        stats,
        log,
      );
      if (text) agendaText += `\n\n======== SUPPORTING / STAFF REPORTS ========\n\n${text}`;
    }

    // Fallback: if findAgendaAndMinutes returned no buttons (typical of
    // packet/resource pages stored as agenda_url for future Planning meetings),
    // treat the page itself as a resource and gather any PDFs linked from it.
    if (!links.agenda && !links.minutes && !links.supporting && agendaText.trim().length < 200) {
      console.log(`${log}   no labelled buttons found, treating ${m.agenda_url} as a resource page`);
      const text = await gatherFromUrl(page, m.agenda_url, MAX_TEXT_TOTAL, stats, log);
      if (text) agendaText += text;
    }

    agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

    // Always call the pipeline — even when text is empty. The pipeline writes
    // extraction_status='success' with 0 items for genuinely-empty meetings
    // (cancelled, no posted agenda, etc.), which removes them from future
    // backfill candidate lists. Skipping here would leave those rows stuck
    // at extraction_status='partial' forever.
    console.log(`${log}   gathered ${agendaText.length} chars + ${stats.scannedPdfs!.length} scanned PDF(s) → pipeline`);
    try {
      await persistExtractedItems(supabase, m.id, m.title, agendaText, stats);
      okCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${log}   pipeline failed: ${msg}`);
      failCount++;
    }

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  await ctx.close();
  console.log(`\n[backfill] done — ${okCount} ok, ${failCount} failed, of ${targets.length} attempted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
