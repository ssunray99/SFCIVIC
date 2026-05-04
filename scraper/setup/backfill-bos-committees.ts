// Re-extract BOS committee meetings under the v3 prompt.
//
// Background: the five standing-committee scrapers (bos-land-use, bos-budget,
// bos-rules, bos-public-safety, bos-gao) all extracted under prompt v2, which
// lacked the matter_file_number field. The v3 prompt adds it. Since meeting
// content_hash hasn't changed, normal scraper runs skip these rows and the
// LLM is never re-invoked.
//
// This script:
//   1. Finds committee meetings whose existing items are ALL v2 (or have 0 items).
//   2. Re-visits each meeting page, finds the Agenda link, gathers PDF text.
//   3. DELETES the existing v2 items for that meeting (cascade clears their locations).
//   4. INSERTS fresh items via the shared v3 pipeline.
//
// Usage:
//   npm run backfill:bos-committees                  # all eligible
//   npm run backfill:bos-committees -- --limit 1     # smoke test
//   npm run backfill:bos-committees -- --source bos-budget   # one source

// Workaround: Node's `--env-file` silently drops the longest var in our
// .env.local (ANTHROPIC_API_KEY). dotenv reads the file correctly. We use
// override:true because some shells inherit an empty ANTHROPIC_API_KEY from
// CI configuration, and override:false would respect that empty value.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { persistItems } from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const COMMITTEE_SOURCES = [
  'bos-land-use',
  'bos-budget',
  'bos-rules',
  'bos-public-safety',
  'bos-gao',
];

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 100_000;

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function gatherTextFromLink(
  page: Page,
  url: string,
  maxChars: number,
): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf') || url.includes('View.ashx')) {
    try {
      const { bytes } = await fetchBytes(url);
      const r = await extractPdfText(bytes);
      return r.text.slice(0, maxChars);
    } catch (err) {
      console.warn(`[backfill-bos] PDF fetch failed ${url}:`, err instanceof Error ? err.message : err);
      return '';
    }
  }
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    const parts: string[] = [htmlToText(html)];
    let totalLen = parts[0].length;
    const pdfLinks = await page.evaluate((): string[] =>
      Array.from(new Set(
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.toLowerCase().endsWith('.pdf')),
      )),
    );
    for (const pdfUrl of pdfLinks.slice(0, 8)) {
      if (totalLen >= maxChars) break;
      try {
        const { bytes } = await fetchBytes(pdfUrl);
        const r = await extractPdfText(bytes);
        if (r.text) {
          const label = pdfUrl.split('/').pop() ?? pdfUrl;
          const block = `\n--- ${label} ---\n${r.text.slice(0, MAX_TEXT_PER_PDF)}`;
          parts.push(block);
          totalLen += block.length;
        }
      } catch (err) {
        console.warn(`[backfill-bos] PDF parse failed ${pdfUrl}:`, err instanceof Error ? err.message : err);
      }
    }
    return parts.join('\n').slice(0, maxChars);
  } catch (err) {
    console.warn(`[backfill-bos] page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return '';
  }
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const sourceArg = process.argv.indexOf('--source');
  const targetSource = sourceArg >= 0 ? process.argv[sourceArg + 1] : null;

  const sources = targetSource ? [targetSource] : COMMITTEE_SOURCES;
  if (targetSource && !COMMITTEE_SOURCES.includes(targetSource)) {
    console.error(`unknown source ${targetSource}; valid: ${COMMITTEE_SOURCES.join(', ')}`);
    process.exit(1);
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Find candidate meetings: all items have prompt_version != 'v3' (or no items).
  type Candidate = {
    id: string;
    source_id: string;
    title: string;
    meeting_date: string;
    agenda_url: string | null;
    item_count: number;
  };
  const candidates: Candidate[] = [];

  // Only past meetings: their agenda_url points to the sf.gov event page
  // (per bos-shared.ts:139). Upcoming meetings store the AGENDA PDF as
  // agenda_url, which makes page.goto trigger a download. Upcoming meetings
  // get re-extracted naturally on the next scrape run.
  const today = new Date().toISOString().slice(0, 10);

  for (const source of sources) {
    const { data: meetings } = await db
      .from('meetings')
      .select('id, source_id, title, meeting_date, agenda_url')
      .eq('source_id', source)
      .eq('needs_ocr', false)
      .lt('meeting_date', today)
      .order('meeting_date', { ascending: false });

    for (const m of meetings ?? []) {
      const { data: items } = await db
        .from('agenda_items')
        .select('prompt_version')
        .eq('meeting_id', m.id);
      const versions = new Set((items ?? []).map((i: { prompt_version: string }) => i.prompt_version));
      // Eligible if there are no items, or all items predate v3.
      if (versions.size === 0 || (!versions.has('v3'))) {
        candidates.push({ ...m, item_count: items?.length ?? 0 });
      }
    }
  }

  console.log(`[backfill-bos] ${candidates.length} committee meeting(s) need re-extraction`);
  if (candidates.length === 0) return;

  const targets = candidates.slice(0, Math.min(candidates.length, limit));
  console.log(`[backfill-bos] processing ${targets.length}\n`);

  const ctx = await newContext();
  const page = await ctx.newPage();

  let okCount = 0;
  for (const m of targets) {
    console.log(`\n[backfill-bos] === ${m.source_id} | ${m.meeting_date} | existing items=${m.item_count}`);
    if (!m.agenda_url) {
      console.warn(`[backfill-bos] no agenda_url, skipping`);
      continue;
    }

    try {
      await page.goto(m.agenda_url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      console.warn(`[backfill-bos] event page nav failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    const meetingLinks = await page.evaluate((): Array<{ text: string; href: string }> =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        text: a.textContent ?? '',
        href: (a as HTMLAnchorElement).href,
      })),
    );
    const today = new Date().toISOString().slice(0, 10);
    const isPast = m.meeting_date < today;
    const agendaHref = meetingLinks.find(({ text }) => normalizeName(text).includes('agenda'))?.href ?? null;
    const minutesHref = meetingLinks.find(({ text }) => normalizeName(text).includes('minutes'))?.href ?? null;

    console.log(`[backfill-bos]   agenda: ${agendaHref ?? '(none)'}`);
    console.log(`[backfill-bos]   minutes: ${minutesHref ?? '(none)'}`);

    let agendaText = '';
    if (agendaHref) {
      const text = await gatherTextFromLink(page, agendaHref, MAX_TEXT_PER_RESOURCE);
      agendaText += text;
    }
    if (isPast && minutesHref && agendaText.length < MAX_TEXT_TOTAL) {
      const remaining = MAX_TEXT_TOTAL - agendaText.length;
      const text = await gatherTextFromLink(page, minutesHref, Math.min(MAX_TEXT_PER_RESOURCE, remaining));
      if (text) agendaText += `\n\n======== MINUTES ========\n\n${text}`;
    }

    agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
    if (agendaText.trim().length < 200) {
      console.warn(`[backfill-bos]   gathered text too short (${agendaText.trim().length}), skipping`);
      continue;
    }

    console.log(`[backfill-bos]   gathered ${agendaText.length} chars → LLM`);
    // Extract first; only delete stale rows if the new extraction succeeded.
    // Otherwise a transient LLM failure would wipe the existing v2 data.
    const { items, promptVersion, model } = await extractAgendaItems(agendaText, m.title);
    if (items.length === 0) {
      console.warn(`[backfill-bos]   LLM returned 0 items — keeping ${m.item_count} stale item(s)`);
      continue;
    }

    if (m.item_count > 0) {
      const { error: delErr } = await db.from('agenda_items').delete().eq('meeting_id', m.id);
      if (delErr) {
        console.warn(`[backfill-bos]   delete failed:`, delErr.message);
        continue;
      }
      console.log(`[backfill-bos]   deleted ${m.item_count} stale item(s)`);
    }

    await persistItems(supabase, m.id, items, promptVersion, model);
    okCount++;
  }

  await ctx.close();
  console.log(`\n[backfill-bos] done — ${okCount}/${targets.length} processed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
