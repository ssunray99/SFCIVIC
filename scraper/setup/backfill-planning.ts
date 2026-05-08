// Backfill Planning Commission meetings that came back empty due to the
// 2026-Q1 button-label change on sfplanning.org (`Agenda` → `Agenda PDF`).
// The fix landed in scraper/sources/planning.ts; this script applies the
// same matcher to past meetings already in the DB so we don't have to
// re-scrape the full grid.
//
// Strategy: for each past Planning meeting with zero agenda_items and not
// titled "...Cancelled", re-visit the event URL, find AGENDA / MINUTES
// links via the new matcher, download + parse each PDF, and run the
// shared extraction pipeline. The existing meeting row is preserved.
//
//   npm run backfill:planning            # all empty non-cancelled meetings
//   npm run backfill:planning -- --limit 1   # just one (smoke test)

import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { htmlToText } from '../lib/llm.ts';
import { persistExtractedItems } from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'planning';
const MAX_PDFS_PER_RESOURCE = 12;
const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 120_000;

async function gatherTextFromLink(
  page: Page,
  url: string,
  maxChars: number,
): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf')) {
    const r = await fetchBytes(url);
    if (!r.ok) {
      console.warn(`[backfill] PDF fetch failed ${url}: ${r.message}`);
      return '';
    }
    const parsed = await extractPdfText(r.bytes);
    return parsed.text.slice(0, maxChars);
  }
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    const pdfLinks = await page.evaluate((): string[] =>
      Array.from(
        new Set(
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.toLowerCase().endsWith('.pdf')),
        ),
      ),
    );
    const parts: string[] = [htmlToText(html)];
    let totalLen = parts[0].length;
    for (const linkedPdf of pdfLinks.slice(0, MAX_PDFS_PER_RESOURCE)) {
      if (totalLen >= maxChars) break;
      const r = await fetchBytes(linkedPdf);
      if (!r.ok) {
        console.warn(`[backfill] PDF fetch failed ${linkedPdf}: ${r.message}`);
        continue;
      }
      const parsed = await extractPdfText(r.bytes);
      if (parsed.text) {
        const label = linkedPdf.split('/').pop() ?? linkedPdf;
        const block = `\n--- ${label} ---\n${parsed.text.slice(0, MAX_TEXT_PER_PDF)}`;
        parts.push(block);
        totalLen += block.length;
      }
    }
    return parts.join('\n').slice(0, maxChars);
  } catch (err) {
    console.warn(`[backfill] resource page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return '';
  }
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Past planning meetings YTD with no extracted items.
  const { data: meetings, error } = await db
    .from('meetings')
    .select('id, title, meeting_date, agenda_url')
    .eq('source_id', SOURCE_ID)
    .eq('needs_ocr', false)
    .lt('meeting_date', today)
    .gte('meeting_date', '2026-01-01')
    .order('meeting_date', { ascending: false });

  if (error) throw error;

  // Filter to those with 0 items and not cancelled.
  const candidates: { id: string; title: string; meeting_date: string; agenda_url: string }[] = [];
  for (const m of meetings ?? []) {
    if (/\bcancell?ed\b/i.test(m.title)) continue;
    const { count } = await db
      .from('agenda_items')
      .select('id', { count: 'exact', head: true })
      .eq('meeting_id', m.id);
    if ((count ?? 0) === 0) candidates.push(m);
  }

  console.log(`[backfill] ${candidates.length} past Planning meeting(s) need extraction`);
  if (candidates.length === 0) return;

  const targets = candidates.slice(0, Math.min(candidates.length, limit));
  console.log(`[backfill] processing ${targets.length}`);

  const ctx = await newContext();
  const page = await ctx.newPage();

  let okCount = 0;
  for (const m of targets) {
    console.log(`\n[backfill] === ${m.meeting_date} — ${m.title}`);
    if (!m.agenda_url) {
      console.warn(`[backfill] no agenda_url, skipping`);
      continue;
    }

    try {
      await page.goto(m.agenda_url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      console.warn(`[backfill] event page nav failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Regexes inlined: a helper function inside page.evaluate trips
    // tsx/esbuild's __name wrapper, undefined in the browser context.
    const sectionLinks = await page.evaluate((): {
      agenda: string | null;
      minutes: string | null;
    } => {
      const out = { agenda: null as string | null, minutes: null as string | null };
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).href;
        const text = (a.textContent ?? '').trim();
        if (!href || /INSERTLINK/i.test(href)) continue;
        if (!out.agenda && /^agenda(\s*\(?pdf\)?)?$/i.test(text)) out.agenda = href;
        else if (!out.minutes && /^minutes(\s*\(?pdf\)?)?$/i.test(text)) out.minutes = href;
      }
      return out;
    });

    console.log(`[backfill]   agenda: ${sectionLinks.agenda ?? '(none)'}`);
    console.log(`[backfill]   minutes: ${sectionLinks.minutes ?? '(none)'}`);

    let agendaText = '';
    if (sectionLinks.agenda) {
      const text = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE);
      agendaText += text;
    }
    if (sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
      const remaining = MAX_TEXT_TOTAL - agendaText.length;
      const budget = Math.min(MAX_TEXT_PER_RESOURCE, remaining);
      const text = await gatherTextFromLink(page, sectionLinks.minutes, budget);
      if (text) agendaText += `\n\n======== MINUTES ========\n\n${text}`;
    }

    agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
    if (agendaText.trim().length < 200) {
      console.warn(`[backfill]   gathered text too short (${agendaText.trim().length} chars), skipping`);
      continue;
    }

    console.log(`[backfill]   gathered ${agendaText.length} chars → LLM`);
    await persistExtractedItems(supabase, m.id, m.title, agendaText);
    okCount++;
  }

  await ctx.close();
  console.log(`\n[backfill] done — ${okCount}/${targets.length} processed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
