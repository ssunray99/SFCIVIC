import type { Page } from 'playwright';
import { newContext, fetchBytes } from './playwright.ts';
import { sha256 } from './hash.ts';
import { extractPdfText } from './pdf.ts';
import { uploadRaw } from './storage.ts';
import { htmlToText } from './llm.ts';
import {
  persistExtractedItems,
  checkMeetingFreshness,
  type GatherStats,
} from './extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const BASE_URL = 'https://www.sf.gov';
const EVENTS_UPCOMING = `${BASE_URL}/departments--board-supervisors/events/upcoming`;
const EVENTS_PAST = `${BASE_URL}/departments--board-supervisors/events/past`;
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

// Caps lifted from v3-era Claude budgets — Gemini 2.5 Flash has a 1M-token
// window so we can afford much more raw context per meeting.
const MAX_TEXT_PER_PDF = 100_000;
const MAX_TEXT_PER_RESOURCE = 400_000;
const MAX_TEXT_TOTAL = 500_000;

export interface BosScraperOptions {
  sourceId: string;
  committeePatterns: string[];
  meetingTitlePrefix: string;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesCommittee(title: string, patterns: string[]): boolean {
  const t = normalizeName(title);
  return patterns.some((pattern) =>
    normalizeName(pattern).split(' ').every((w) => t.includes(w)),
  );
}

export async function scrapeBosMeetings(opts: BosScraperOptions): Promise<void> {
  const { sourceId, committeePatterns, meetingTitlePrefix } = opts;
  const LOG = `[${sourceId}]`;
  const supabase = createAdminClient();

  const { data: run, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({ source_id: sourceId, status: 'running' })
    .select('id')
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  let itemsFound = 0;
  let itemsNew = 0;

  try {
    const ctx = await newContext();
    const page = await ctx.newPage();

    const meetingUrls = new Set<string>();

    for (const listingUrl of [EVENTS_UPCOMING, EVENTS_PAST]) {
      await collectMeetingUrls(page, listingUrl, BASE_URL, meetingUrls, LOG);
    }

    console.log(`${LOG} ${meetingUrls.size} total meeting URL(s) found`);

    for (const meetingUrl of meetingUrls) {
      await page.goto(meetingUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      const title = await page.evaluate(
        () => document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );

      if (!matchesCommittee(title, committeePatterns)) continue;

      itemsFound++;
      console.log(`${LOG} processing: ${title} — ${meetingUrl}`);

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
        console.log(`${LOG} skipping pre-${SCRAPE_FROM} meeting (${meetingDate})`);
        continue;
      }

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

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const externalId = meetingUrl.split('/').filter(Boolean).pop() ?? null;

      // Idempotency: skip iff this exact event-page HTML is already extracted
      // under v4. Otherwise we'll re-extract (covers transient LLM failures,
      // partial gathers, and prompt-version upgrades).
      const freshness = await checkMeetingFreshness(supabase, sourceId, contentHash);
      if (freshness.fresh) {
        console.log(`${LOG} already stored + extracted (status=success v=current), skipping`);
        continue;
      }
      if (freshness.existingId) {
        console.log(`${LOG} re-extracting existing meeting (status=${freshness.status})`);
      }

      // Now do the (possibly expensive) PDF gather.
      const stats: GatherStats = {
        scannedPdfs: [],
        fetchWarnings: [],
        expectedPdfCount: 0,
        fetchedPdfCount: 0,
      };
      let agendaText = '';

      if (sectionLinks.agenda) {
        console.log(`${LOG} agenda: ${sectionLinks.agenda}`);
        const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE, LOG, stats);
        agendaText += r.text;
      }

      if (isPast && sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`${LOG} minutes: ${sectionLinks.minutes}`);
        const r = await gatherTextFromLink(
          page,
          sectionLinks.minutes,
          Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
          LOG,
          stats,
        );
        if (r.text) agendaText += `\n\n======== MINUTES ========\n\n${r.text}`;
      }

      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
      const sourceUrl = isPast ? meetingUrl : (sectionLinks.agenda ?? meetingUrl);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);

      let meetingId: string | null = freshness.existingId;

      if (!meetingId) {
        // New meeting — insert.
        let rawStoragePath: string | null = null;
        try {
          rawStoragePath = await uploadRaw({ sourceId, contentHash, bytes, mime: 'text/html' });
        } catch (err) {
          console.warn(`${LOG} storage upload failed, continuing:`, err);
        }

        const fullTitle = `${meetingTitlePrefix} — ${title}`;

        const { data: inserted, error: insertErr } = await supabase
          .from('meetings')
          .insert({
            source_id: sourceId,
            external_id: externalId,
            title: fullTitle,
            meeting_date: date,
            agenda_url: sourceUrl,
            raw_storage_path: rawStoragePath,
            content_hash: contentHash,
            needs_ocr: stats.scannedPdfs!.length > 0,
          })
          .select('id')
          .single();

        if (insertErr) {
          if (insertErr.code === '23505') {
            // (source_id, external_id) collision — content evolved since the
            // original scrape. Update the row in place and re-extract.
            console.log(`${LOG} content changed for ${externalId}, updating row`);
            const { data: existingRow } = await supabase
              .from('meetings')
              .select('id')
              .eq('source_id', sourceId)
              .eq('external_id', externalId)
              .maybeSingle();
            if (existingRow) {
              await supabase
                .from('meetings')
                .update({
                  content_hash: contentHash,
                  raw_storage_path: rawStoragePath,
                  agenda_url: sourceUrl,
                  needs_ocr: stats.scannedPdfs!.length > 0,
                })
                .eq('id', existingRow.id);
              meetingId = existingRow.id;
            }
          } else {
            console.error(`${LOG} insert error:`, insertErr.message);
            continue;
          }
        } else {
          meetingId = inserted?.id ?? null;
          itemsNew++;
          console.log(`${LOG} ✓ stored: ${fullTitle} (${date})`);
        }
      } else {
        // Existing meeting — refresh content_hash + agenda_url in case the
        // event page evolved (new minutes posted, etc.).
        await supabase
          .from('meetings')
          .update({
            content_hash: contentHash,
            agenda_url: sourceUrl,
            needs_ocr: stats.scannedPdfs!.length > 0,
          })
          .eq('id', meetingId);
      }

      if (meetingId) {
        await persistExtractedItems(
          supabase,
          meetingId,
          `${meetingTitlePrefix} — ${title}`,
          agendaText,
          stats,
        );
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

    console.log(`${LOG} done — ${itemsNew} new / ${itemsFound} found`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('scrape_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: msg })
      .eq('id', runId);
    throw err;
  }
}

async function collectMeetingUrls(
  page: Page,
  listingUrl: string,
  base: string,
  out: Set<string>,
  log: string,
): Promise<void> {
  console.log(`${log} scanning listing: ${listingUrl}`);
  // Bumped from 20 in origin's #23 fix — sf.gov listings are long enough
  // that 20 pages dropped older meetings.
  const MAX_PAGES = 50;

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
    let onPage = 0;
    for (const href of hrefs) {
      if (
        href.startsWith(base + '/') &&
        !href.includes('#') &&
        /committee-meeting|board-meeting|meeting-\d/.test(href)
      ) {
        out.add(href);
        onPage++;
      }
    }
    const added = out.size - before;
    console.log(`${log} listing page ${pageNum + 1}: ${added} new meeting link(s)`);

    // Stop only when the page has no matching links at all (true end of pagination).
    // Stopping on added===0 is too aggressive: less-frequent committees share the
    // listing with high-volume ones, so early pages may be all-duplicates even
    // though later pages still contain unseen meetings.
    if (onPage === 0) break;
  }
}

async function gatherTextFromLink(
  page: Page,
  url: string,
  maxChars: number,
  log: string,
  stats: GatherStats,
): Promise<{ text: string }> {
  if (url.toLowerCase().endsWith('.pdf') || url.includes('View.ashx')) {
    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + 1;
    const r = await fetchBytes(url);
    if (!r.ok) {
      stats.fetchWarnings!.push(`${url}: ${r.message}`);
      console.warn(`${log} PDF fetch failed ${url}: ${r.message}`);
      return { text: '' };
    }
    stats.fetchedPdfCount = (stats.fetchedPdfCount ?? 0) + 1;
    const parsed = await extractPdfText(r.bytes);
    if (parsed.needsOcr || !parsed.text) {
      // Save bytes for Gemini multimodal fallback.
      const label = url.split('/').pop() ?? url;
      stats.scannedPdfs!.push({ label, bytes: r.bytes });
      stats.fetchWarnings!.push(`${url}: scanned/OCR-only PDF (${r.bytes.length} bytes)`);
    }
    return { text: parsed.text.slice(0, maxChars) };
  }

  // /resource/ or sf.gov page — visit it, then download each linked PDF.
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
            .filter((h) => h.toLowerCase().endsWith('.pdf') || h.includes('View.ashx')),
        ),
      ],
    );

    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + pdfLinks.length;

    for (const pdfUrl of pdfLinks.slice(0, 12)) {
      if (totalLen >= maxChars) break;
      const r = await fetchBytes(pdfUrl);
      if (!r.ok) {
        stats.fetchWarnings!.push(`${pdfUrl}: ${r.message}`);
        console.warn(`${log} PDF fetch failed ${pdfUrl}: ${r.message}`);
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
        totalLen += block.length;
      }
    }

    return { text: parts.join('\n').slice(0, maxChars) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fetchWarnings!.push(`${url}: ${msg}`);
    console.warn(`${log} page fetch failed ${url}: ${msg}`);
    return { text: '' };
  }
}
