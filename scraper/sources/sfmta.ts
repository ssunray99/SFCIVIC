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
import { persistExtractedItems } from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'sfmta';
const BASE_URL = 'https://www.sfmta.com';
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 100_000;

function isBoardMeetingUrl(href: string): boolean {
  const lower = href.toLowerCase();
  return lower.includes('/calendar/') && lower.includes('board') && lower.includes('directors');
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

    // Collect board meeting URLs from main listing (upcoming + paginated past).
    for (const listingUrl of [
      `${BASE_URL}/meetings-events`,
      `${BASE_URL}/calendar/sfmta-board-directors-meetings`,
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

      // Skip if not actually a Board of Directors meeting
      if (!title.toLowerCase().includes('board') || !title.toLowerCase().includes('directors')) {
        console.log(`[sfmta] skipping non-board page: ${title}`);
        continue;
      }

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
        console.log(`[sfmta] skipping pre-${SCRAPE_FROM} meeting (${meetingDate})`);
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
      const isPast = !!meetingDate && meetingDate < today;

      let agendaText = '';

      if (agendaLink) {
        console.log(`[sfmta] agenda: ${agendaLink}`);
        const r = await gatherText(page, agendaLink, MAX_TEXT_PER_RESOURCE);
        agendaText += r;
      }

      if (isPast && minutesLink && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`[sfmta] minutes: ${minutesLink}`);
        const r = await gatherText(
          page,
          minutesLink,
          Math.min(MAX_TEXT_PER_RESOURCE, MAX_TEXT_TOTAL - agendaText.length),
        );
        if (r) agendaText += `\n\n======== MINUTES ========\n\n${r}`;
      }

      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);
      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

      const needsOcr = agendaText.trim().length < 200;
      if (needsOcr) console.warn(`[sfmta] needs OCR: ${meetingUrl}`);

      const sourceUrl = isPast ? meetingUrl : (agendaLink ?? meetingUrl);
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
        console.log(`[sfmta] already stored, skipping`);
        continue;
      }

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

      const fullTitle = title.startsWith('SFMTA') ? title : `SFMTA ${title}`;

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
          console.log(`[sfmta] duplicate insert skipped`);
        } else {
          console.error(`[sfmta] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[sfmta] ✓ stored: ${fullTitle} (${date})`);

      const { data: newRow } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .single();

      if (newRow?.id && !needsOcr) {
        await persistExtractedItems(supabase, newRow.id, fullTitle, agendaText);
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

async function gatherText(page: Page, url: string, maxChars: number): Promise<string> {
  if (url.toLowerCase().endsWith('.pdf')) {
    try {
      const { bytes } = await fetchBytes(url);
      const r = await extractPdfText(bytes);
      return r.text.slice(0, maxChars);
    } catch (err) {
      console.warn(`[sfmta] PDF fetch failed ${url}:`, err instanceof Error ? err.message : err);
      return '';
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
        console.warn(
          `[sfmta] PDF parse failed ${pdfUrl}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return parts.join('\n').slice(0, maxChars);
  } catch (err) {
    console.warn(`[sfmta] page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return '';
  }
}
