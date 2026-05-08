// SFMTA Board of Directors scraper — sfmta.com
//
// Board meetings are listed at sfmta.com/meetings-events.
// Detail pages follow /calendar/*board*directors*meeting* URL pattern.
// BoardDocs (go.boarddocs.com/ca/sfmta) is the canonical agenda platform but
// blocks automated fetches (403); sfmta.com is the accessible ingest source.

import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { htmlToText } from '../lib/llm.ts';
import {
  persistExtractedItems,
  checkMeetingFreshness,
  type GatherStats,
} from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'sfmta';
const BASE_URL = 'https://www.sfmta.com';
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

// Caps lifted in v4.
const MAX_TEXT_PER_PDF = 100_000;
const MAX_TEXT_PER_RESOURCE = 400_000;
const MAX_TEXT_TOTAL = 500_000;

function isBoardMeetingUrl(href: string): boolean {
  const path = href.split('?')[0].split('#')[0].toLowerCase();
  return path.includes('/calendar/board-directors-meeting-');
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

    const meetingUrls = new Set<string>();

    // Listing pages SFMTA uses to surface board meetings:
    //   /meetings-events                    — upcoming + recent (handful of meetings)
    //   /past-meetings-and-events/2625      — paginated past archive (~18 pages × 14)
    // The previous URL `/calendar/sfmta-board-directors-meetings` returns 404
    // as of 2026-Q2 and is dropped.
    for (const listingUrl of [
      `${BASE_URL}/meetings-events`,
      `${BASE_URL}/past-meetings-and-events/2625`,
    ]) {
      await collectBoardUrls(page, listingUrl, meetingUrls);
    }

    console.log(`[sfmta] ${meetingUrls.size} board meeting URL(s) found`);

    for (const meetingUrl of meetingUrls) {
      itemsFound++;
      console.log(`[sfmta] visiting: ${meetingUrl}`);

      await page.goto(meetingUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      const title = await page.evaluate(
        () => document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );

      if (!title.toLowerCase().includes('board') || !title.toLowerCase().includes('directors')) {
        console.log(`[sfmta] skipping non-board page: ${title}`);
        continue;
      }

      const meetingDate = await page.evaluate((): string | null => {
        for (const el of Array.from(document.querySelectorAll('time[datetime]'))) {
          const dt = (el as HTMLTimeElement).dateTime;
          if (dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
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

      const parsedMeetingDate = meetingDate ?? (() => {
        const slug = meetingUrl.split('/').pop() ?? '';
        const m = slug.match(
          /(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})$/i,
        );
        if (!m) return null;
        const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      })();

      if (parsedMeetingDate && parsedMeetingDate < SCRAPE_FROM) {
        console.log(`[sfmta] skipping pre-${SCRAPE_FROM} meeting (${parsedMeetingDate})`);
        continue;
      }

      const links = await page.evaluate((): Array<{ text: string; href: string }> =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          text: (a.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
          href: (a as HTMLAnchorElement).href,
        })),
      );

      const agendaLink =
        links.find(({ text }) => text.includes('agenda') && !text.includes('minutes'))?.href ??
        null;
      const minutesLink = links.find(({ text }) => text.includes('minutes'))?.href ?? null;

      const eventHtml = await page.content();
      const today = new Date().toISOString().slice(0, 10);
      const isPast = !!parsedMeetingDate && parsedMeetingDate < today;

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const externalId = meetingUrl.split('/').filter(Boolean).pop() ?? null;

      const freshness = await checkMeetingFreshness(supabase, SOURCE_ID, contentHash);
      if (freshness.fresh) {
        console.log(`[sfmta] already stored + extracted, skipping`);
        continue;
      }
      if (freshness.existingId) {
        console.log(`[sfmta] re-extracting existing meeting (status=${freshness.status})`);
      }

      const stats: GatherStats = {
        scannedPdfs: [],
        fetchWarnings: [],
        expectedPdfCount: 0,
        fetchedPdfCount: 0,
      };
      let agendaText = '';

      if (agendaLink) {
        console.log(`[sfmta] agenda: ${agendaLink}`);
        const r = await gatherText(page, agendaLink, MAX_TEXT_PER_RESOURCE, stats);
        agendaText += r;
      }

      if (isPast && minutesLink && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`[sfmta] minutes: ${minutesLink}`);
        const r = await gatherText(
          page,
          minutesLink,
          Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
          stats,
        );
        if (r) agendaText += `\n\n======== MINUTES ========\n\n${r}`;
      }

      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);
      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

      const sourceUrl = isPast ? meetingUrl : (agendaLink ?? meetingUrl);
      const date = parsedMeetingDate ?? new Date().toISOString().slice(0, 10);
      const fullTitle = title.startsWith('SFMTA') ? title : `SFMTA ${title}`;

      let meetingId: string | null = freshness.existingId;

      if (!meetingId) {
        let rawStoragePath: string | null = null;
        try {
          rawStoragePath = await uploadRaw({
            sourceId: SOURCE_ID,
            contentHash,
            bytes,
            mime: 'text/html',
          });
        } catch (err) {
          console.warn(`[sfmta] storage upload failed, continuing:`, err);
        }

        const { data: inserted, error: insertErr } = await supabase
          .from('meetings')
          .insert({
            source_id: SOURCE_ID,
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
            const { data: existingRow } = await supabase
              .from('meetings')
              .select('id')
              .eq('source_id', SOURCE_ID)
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
            console.error(`[sfmta] insert error:`, insertErr.message);
            continue;
          }
        } else {
          meetingId = inserted?.id ?? null;
          itemsNew++;
          console.log(`[sfmta] ✓ stored: ${fullTitle} (${date})`);
        }
      } else {
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
        await persistExtractedItems(supabase, meetingId, fullTitle, agendaText, stats);
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

    console.log(`[sfmta] done — ${itemsNew} new / ${itemsFound} found`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('scrape_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: msg })
      .eq('id', runId);
    throw err;
  }
}

async function collectBoardUrls(
  page: Page,
  listingUrl: string,
  out: Set<string>,
): Promise<void> {
  console.log(`[sfmta] scanning listing: ${listingUrl}`);
  // Bumped from 20 in origin's #23 fix.
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
      if (isBoardMeetingUrl(href)) {
        out.add(href);
        onPage++;
      }
    }
    const added = out.size - before;
    console.log(`[sfmta] listing page ${pageNum + 1}: ${added} new board meeting link(s)`);

    if (onPage === 0) break;
  }
}

async function gatherText(
  page: Page,
  url: string,
  maxChars: number,
  stats: GatherStats,
): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf')) {
    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + 1;
    const r = await fetchBytes(url);
    if (!r.ok) {
      stats.fetchWarnings!.push(`${url}: ${r.message}`);
      console.warn(`[sfmta] PDF fetch failed ${url}: ${r.message}`);
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

    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + pdfLinks.length;

    for (const pdfUrl of pdfLinks.slice(0, 12)) {
      if (totalLen >= maxChars) break;
      const r = await fetchBytes(pdfUrl);
      if (!r.ok) {
        stats.fetchWarnings!.push(`${pdfUrl}: ${r.message}`);
        console.warn(`[sfmta] PDF fetch failed ${pdfUrl}: ${r.message}`);
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

    return parts.join('\n').slice(0, maxChars);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fetchWarnings!.push(`${url}: ${msg}`);
    console.warn(`[sfmta] page fetch failed ${url}: ${msg}`);
    return '';
  }
}
