import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'bos';
const BASE_URL = 'https://sfbos.org';
const MEETINGS_HUB = `${BASE_URL}/meetings`;
// Only import meetings from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 100_000;

// Substring matches against link text on the meetings hub page.
// Order matters: listed top-to-bottom as they appear on the page.
const TARGET_COMMITTEE_PATTERNS = [
  'Full Board',
  'Budget and Appropriations',
  'Land Use and Transportation',
  'Government Audit and Oversight',
  'Public Safety and Neighborhood Services',
  'Downtown Revitalization',
];

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

    // Discover committee page URLs by matching link text on the meetings hub.
    // Normalise "&" → "and" and match word-by-word so patterns like
    // "Budget and Appropriations" hit "Budget & Appropriations Committee".
    await page.goto(MEETINGS_HUB, { waitUntil: 'networkidle', timeout: 45_000 });

    // Fetch all links from the hub and match in Node.js to avoid esbuild
    // injecting __name() helpers into the browser-executed evaluate string.
    const hubLinks = await page.evaluate(
      (): Array<{ text: string; href: string }> =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          text: a.textContent ?? '',
          href: (a as HTMLAnchorElement).href,
        })),
    );

    function normalizeName(s: string): string {
      return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    const committeeUrls = TARGET_COMMITTEE_PATTERNS
      .map((pattern) => {
        const words = normalizeName(pattern).split(' ');
        const match = hubLinks.find(
          ({ text }) => words.every((w) => normalizeName(text).includes(w)),
        );
        return match && match.href.startsWith(BASE_URL) ? match.href : null;
      })
      .filter((url): url is string => url !== null);

    // Temporary: log all links on the page (unfiltered) for diagnosis
    console.log(`[bos] hub page has ${hubLinks.length} total links:`);
    for (const { text, href } of hubLinks.slice(0, 40)) {
      console.log(`  "${text.replace(/\s+/g, ' ').trim()}" → ${href}`);
    }
    console.log(`[bos] found ${committeeUrls.length} committee page(s)`);

    // Collect meeting detail URLs from each committee page.
    const meetingUrls = new Set<string>();
    const scrapeYear = new Date().getFullYear();
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];

    for (const committeeUrl of committeeUrls) {
      console.log(`[bos] scanning committee: ${committeeUrl}`);

      let pageNum = 0;
      let firstPage = true;

      while (true) {
        const url =
          firstPage
            ? committeeUrl
            : `${committeeUrl}${committeeUrl.includes('?') ? '&' : '?'}page=${pageNum}`;

        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        } catch {
          break;
        }

        if (firstPage) firstPage = false;

        // Collect links that look like individual meeting detail pages.
        const allHrefs = await page.evaluate(
          (): string[] =>
            Array.from(document.querySelectorAll('a[href]')).map(
              (a) => (a as HTMLAnchorElement).href,
            ),
        );
        const yearStr = String(scrapeYear);
        const links = allHrefs.filter(
          (href) =>
            href.startsWith(BASE_URL + '/') &&
            !href.includes('#') &&
            (href.includes(yearStr) || /\d{4}-\d{2}-\d{2}|agenda|meeting-\d/.test(href)),
        );

        const before = meetingUrls.size;
        for (const l of links) meetingUrls.add(l);
        const added = meetingUrls.size - before;
        console.log(`[bos] committee page ${pageNum + 1}: ${added} new meeting link(s)`);

        if (added === 0) break;

        // Stop paginating once the page no longer shows the target year.
        const hasTargetYear = await page.evaluate(
          ({ year, months }: { year: number; months: string[] }) =>
            months.some((m) => document.body.innerText.includes(`${m} ${year}`)),
          { year: scrapeYear, months: monthNames },
        );
        if (!hasTargetYear) break;

        const hasNext = await page.$('a[title="Go to next page"], a:has-text("Next page")');
        if (!hasNext) break;
        pageNum++;
      }
    }

    console.log(`[bos] ${meetingUrls.size} meeting URL(s) to process`);

    for (const meetingUrl of meetingUrls) {
      itemsFound++;
      console.log(`[bos] visiting meeting: ${meetingUrl}`);

      await page.goto(meetingUrl, { waitUntil: 'networkidle', timeout: 30_000 });

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

      const title = await page.evaluate(
        () =>
          document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'SF Board of Supervisors Meeting',
      );

      // Find Agenda and Minutes links by their visible text, same pattern as
      // the Planning Commission scraper.
      const sectionLinks = await page.evaluate((): {
        agenda: string | null;
        minutes: string | null;
      } => {
        const out = { agenda: null as string | null, minutes: null as string | null };
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href;
          const text = (a.textContent ?? '').trim().toLowerCase();
          if (!out.agenda && text === 'agenda') out.agenda = href;
          if (!out.minutes && text === 'minutes') out.minutes = href;
        }
        return out;
      });

      // Snapshot the meeting page HTML before navigating away.
      const eventHtml = await page.content();

      // Past meetings: Agenda + Minutes.  Future meetings: Agenda only.
      const today = new Date().toISOString().slice(0, 10);
      const isPast = !!meetingDate && meetingDate < today;

      let agendaText = '';

      if (sectionLinks.agenda) {
        console.log(`[bos] agenda link: ${sectionLinks.agenda}`);
        const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE);
        agendaText += r.text;
      }

      if (isPast && sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`[bos] minutes link: ${sectionLinks.minutes}`);
        const remaining = MAX_TEXT_TOTAL - agendaText.length;
        const r = await gatherTextFromLink(
          page,
          sectionLinks.minutes,
          Math.min(MAX_TEXT_PER_RESOURCE, remaining),
        );
        if (r.text) agendaText += `\n\n======== MINUTES ========\n\n${r.text}`;
      }

      // Fall back to event-page text if links yielded nothing.
      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
      const needsOcr = agendaText.trim().length < 200;
      if (needsOcr) console.warn(`[bos] needs OCR: ${meetingUrl}`);

      // agenda_url: for past meetings use the event page (user can navigate to
      // both Agenda and Minutes); for future use the agenda link if available.
      const sourceUrl = isPast
        ? meetingUrl
        : (sectionLinks.agenda ?? meetingUrl);

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId = meetingUrl.split('/').filter(Boolean).pop() ?? null;

      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[bos] already stored, skipping`);
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
 * Fetch text from a BOS link, which may be a direct PDF or an HTML page
 * that lists linked PDFs (same dual-mode logic as the Planning scraper).
 */
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

  // HTML page — visit it, extract page text, then download any linked PDFs.
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
          `[bos] PDF fetch/parse failed ${pdfUrl}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { text: parts.join('\n').slice(0, maxChars) };
  } catch (err) {
    console.warn(`[bos] page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return { text: '' };
  }
}

type SupabaseClient = ReturnType<typeof createAdminClient>;

async function runLlmExtraction(
  supabase: SupabaseClient,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
): Promise<void> {
  console.log(`[llm] extracting items for BOS meeting ${meetingId}`);
  const { items, promptVersion, model } = await extractAgendaItems(agendaText, meetingTitle);

  if (items.length === 0) {
    console.log(`[llm] no items extracted for ${meetingId}`);
    return;
  }

  const rows = items.map((item) => ({
    meeting_id: meetingId,
    position: item.position ?? null,
    title: item.title,
    summary: item.summary,
    item_type: item.item_type,
    district: item.district ?? null,
    neighborhoods: item.neighborhoods,
    topics: item.topics,
    llm_model: model,
    prompt_version: promptVersion,
    llm_extracted_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('agenda_items').insert(rows);
  if (error) {
    console.error(`[llm] insert failed for ${meetingId}:`, error.message);
  } else {
    console.log(`[llm] ✓ inserted ${rows.length} agenda item(s) for ${meetingId}`);
  }
}
