import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { htmlToText } from '../lib/llm.ts';
import { persistExtractedItems } from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'bos';
const BASE_URL = 'https://www.sf.gov';
// BOS meetings are listed under the sf.gov portal (sfbos.org redirects here).
const EVENTS_UPCOMING = `${BASE_URL}/departments--board-supervisors/events/upcoming`;
const EVENTS_PAST = `${BASE_URL}/departments--board-supervisors/events/past`;
// Only import meetings from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 100_000;

// Word-level patterns matched against each meeting's page title.
// Normalisation collapses "&" → "and" and strips punctuation before matching.
const TARGET_COMMITTEE_PATTERNS = [
  'Full Board',
  'Budget and Appropriations',
  'Land Use and Transportation',
  'Government Audit and Oversight',
  'Public Safety and Neighborhood Services',
  'Downtown Revitalization',
];

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesCommittee(title: string): boolean {
  const t = normalizeName(title);
  return TARGET_COMMITTEE_PATTERNS.some((pattern) =>
    normalizeName(pattern).split(' ').every((w) => t.includes(w)),
  );
}

export async function scrape(): Promise<void> {
  const supabase = createAdminClient();

  const { data: run, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({ source_id: SOURCE_ID, status: 'running' })
    .select('id')
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  let itemsFound = 0;
  let itemsNew = 0;

  try {
    const ctx = await newContext();
    const page = await ctx.newPage();

    // Collect individual meeting page URLs from both the upcoming and past
    // events listings. Meeting URLs on sf.gov follow the pattern:
    //   /www.sf.gov/{committee-slug}-meeting-{dateid}
    const meetingUrls = new Set<string>();

    for (const listingUrl of [EVENTS_UPCOMING, EVENTS_PAST]) {
      await collectMeetingUrls(page, listingUrl, BASE_URL, meetingUrls);
    }

    console.log(`[bos] ${meetingUrls.size} total meeting URL(s) found`);

    for (const meetingUrl of meetingUrls) {
      await page.goto(meetingUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      const title = await page.evaluate(
        () => document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );

      // Skip committees not in our target list.
      if (!matchesCommittee(title)) continue;

      itemsFound++;
      console.log(`[bos] processing: ${title} — ${meetingUrl}`);

      const meetingDate = await page.evaluate((): string | null => {
        const time = document.querySelector('time[datetime]');
        if (time) {
          const dt = (time as HTMLTimeElement).dateTime;
          if (dt) return dt.slice(0, 10);
        }
        const text = document.body.innerText;
        const m = text.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
        );
        if (m) {
          const d = new Date(m[0]);
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        return null;
      });

      if (meetingDate && meetingDate < SCRAPE_FROM) {
        console.log(`[bos] skipping pre-${SCRAPE_FROM} meeting (${meetingDate})`);
        continue;
      }

      // Find Agenda and Minutes links in Node.js using the same normaliseName
      // helper so punctuation variants ("Agenda (PDF)", "View Agenda", etc.) all match.
      const meetingLinks = await page.evaluate((): Array<{ text: string; href: string }> =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          text: a.textContent ?? '',
          href: (a as HTMLAnchorElement).href,
        })),
      );
      const sectionLinks = {
        agenda:  meetingLinks.find(({ text }) => normalizeName(text).includes('agenda'))?.href  ?? null,
        minutes: meetingLinks.find(({ text }) => normalizeName(text).includes('minutes'))?.href ?? null,
      };

      const eventHtml = await page.content();

      const today = new Date().toISOString().slice(0, 10);
      const isPast = !!meetingDate && meetingDate < today;

      let agendaText = '';

      if (sectionLinks.agenda) {
        console.log(`[bos] agenda: ${sectionLinks.agenda}`);
        const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE);
        agendaText += r.text;
      }

      if (isPast && sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`[bos] minutes: ${sectionLinks.minutes}`);
        const r = await gatherTextFromLink(
          page,
          sectionLinks.minutes,
          Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
        );
        if (r.text) agendaText += `\n\n======== MINUTES ========\n\n${r.text}`;
      }

      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
      const needsOcr = agendaText.trim().length < 200;
      if (needsOcr) console.warn(`[bos] needs OCR: ${meetingUrl}`);

      const sourceUrl = isPast ? meetingUrl : (sectionLinks.agenda ?? meetingUrl);
      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId = meetingUrl.split('/').filter(Boolean).pop() ?? null;

      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .or(`content_hash.eq.${contentHash},external_id.eq.${externalId}`)
        .maybeSingle();

      if (existing) {
        console.log(`[bos] already stored, skipping`);
        continue;
      }

      let rawStoragePath: string | null = null;
      try {
        rawStoragePath = await uploadRaw({ sourceId: SOURCE_ID, contentHash, bytes, mime: 'text/html' });
      } catch (err) {
        console.warn(`[bos] storage upload failed, continuing:`, err);
      }

      const fullTitle = `SF Board of Supervisors — ${title}`;

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: fullTitle,
        meeting_date: date,
        agenda_url: sourceUrl,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: needsOcr,
      });

      if (insertErr) {
        if (insertErr.code === '23505') {
          console.log(`[bos] duplicate insert skipped`);
        } else {
          console.error(`[bos] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[bos] ✓ stored: ${fullTitle} (${date})`);

      const { data: newRow } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .single();

      if (newRow?.id && !needsOcr) {
        await runLlmExtraction(supabase, newRow.id, fullTitle, agendaText);
      }
    }

    await ctx.close();

    await supabase
      .from('scrape_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        items_found: itemsFound,
        items_new: itemsNew,
      })
      .eq('id', runId);

    console.log(`[bos] done — ${itemsNew} new / ${itemsFound} found`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('scrape_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: msg })
      .eq('id', runId);
    throw err;
  }
}

/**
 * Paginate a sf.gov BOS events listing page and collect individual meeting URLs.
 * Meeting links on sf.gov follow the pattern /www.sf.gov/*-meeting-* or
 * /www.sf.gov/*committee-meeting*.
 */
async function collectMeetingUrls(
  page: Page,
  listingUrl: string,
  base: string,
  out: Set<string>,
): Promise<void> {
  console.log(`[bos] scanning listing: ${listingUrl}`);
  const MAX_PAGES = 20;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const sep = listingUrl.includes('?') ? '&' : '?';
    const url = pageNum === 0 ? listingUrl : `${listingUrl}${sep}page=${pageNum}`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch {
      break;
    }

    const hrefs = await page.evaluate((): string[] =>
      Array.from(document.querySelectorAll('a[href]')).map(
        (a) => (a as HTMLAnchorElement).href,
      ),
    );

    const before = out.size;
    for (const href of hrefs) {
      if (
        href.startsWith(base + '/') &&
        !href.includes('#') &&
        /committee-meeting|board-meeting|meeting-\d/.test(href)
      ) {
        out.add(href);
      }
    }
    const added = out.size - before;
    console.log(`[bos] listing page ${pageNum + 1}: ${added} new meeting link(s)`);

    if (added === 0) break;
  }
}

async function gatherTextFromLink(
  page: Page,
  url: string,
  maxChars: number,
): Promise<{ text: string }> {
  if (url.toLowerCase().endsWith('.pdf')) {
    try {
      const { bytes } = await fetchBytes(url);
      const r = await extractPdfText(bytes);
      return { text: r.text.slice(0, maxChars) };
    } catch (err) {
      console.warn(`[bos] PDF fetch failed ${url}:`, err instanceof Error ? err.message : err);
      return { text: '' };
    }
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    const parts: string[] = [htmlToText(html)];
    let totalLen = parts[0].length;

    const pdfLinks = await page.evaluate((): string[] =>
      [
        ...new Set(
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.toLowerCase().endsWith('.pdf')),
        ),
      ],
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
        console.warn(`[bos] PDF parse failed ${pdfUrl}:`, err instanceof Error ? err.message : err);
      }
    }

    return { text: parts.join('\n').slice(0, maxChars) };
  } catch (err) {
    console.warn(`[bos] page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return { text: '' };
  }
}

async function runLlmExtraction(
  supabase: ReturnType<typeof createAdminClient>,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
): Promise<void> {
  await persistExtractedItems(supabase, meetingId, meetingTitle, agendaText);
}
