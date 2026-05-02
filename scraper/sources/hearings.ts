import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'hearings';
const BASE_URL = 'https://sfplanning.org';
// Try the notices grid first (same Drupal view pattern as hearings-cpc-grid);
// fall back to the plain notices page if the grid URL doesn't exist.
const GRID_URL = `${BASE_URL}/notices`;
// Only import notices from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_TOTAL = 80_000;

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

    await page.goto(GRID_URL, { waitUntil: 'networkidle', timeout: 45_000 });

    // The notices grid may have timing/sort filters like the CPC grid.
    // Try to show all notices (not just upcoming) and sort descending.
    const filterApplied = await page.evaluate((): boolean => {
      let changed = false;
      for (const sel of Array.from(document.querySelectorAll('select'))) {
        const opts = Array.from(sel.options);
        if (opts.some((o) => /upcoming/i.test(o.text))) {
          const any =
            opts.find((o) => /any/i.test(o.text)) ??
            opts.find((o) => /all/i.test(o.text)) ??
            opts.find((o) => o.value === '');
          if (any && any.value !== sel.value) {
            sel.value = any.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            changed = true;
          }
        }
        if (opts.some((o) => /ascending/i.test(o.text))) {
          const desc = opts.find((o) => /descending/i.test(o.text));
          if (desc && desc.value !== sel.value) {
            sel.value = desc.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            changed = true;
          }
        }
      }
      return changed;
    });

    if (filterApplied) {
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 45_000 }),
        page.click(
          'input[type="submit"][value="Apply"], ' +
            'input[type="submit"][value="APPLY"], ' +
            'button[type="submit"]',
        ),
      ]);
      console.log(`[hearings] switched grid to all-notices descending (${page.url()})`);
    }

    const baseGridUrl = page.url();

    // Paginate. Stop when there are no month headers from the target year.
    const scrapeYear = Number(SCRAPE_FROM.slice(0, 4));
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];

    const eventUrls = new Set<string>();
    let pageNum = 0;
    let firstPage = true;

    while (true) {
      if (!firstPage) {
        const sep = baseGridUrl.includes('?') ? '&' : '?';
        const url = `${baseGridUrl}${sep}page=${pageNum}`;
        console.log(`[hearings] fetching grid page ${pageNum + 1}: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      } else {
        console.log(`[hearings] fetching grid page 1 (already loaded)`);
        firstPage = false;
      }

      // Collect links to individual notice/event pages.
      const hrefs = await page.evaluate((): string[] =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter(
            (h) =>
              h.includes('/event/') ||
              h.includes('/notice/') ||
              h.includes('/hearing-notice'),
          ),
      );

      const before = eventUrls.size;
      for (const h of hrefs) eventUrls.add(h);
      const added = eventUrls.size - before;
      console.log(
        `[hearings] grid page ${pageNum + 1}: ${added} new notice(s) (${eventUrls.size} total)`,
      );

      if (added === 0) break;

      const hasTargetYear = await page.evaluate(
        ({ year, months }: { year: number; months: string[] }) =>
          months.some((m) => document.body.innerText.includes(`${m} ${year}`)),
        { year: scrapeYear, months: monthNames },
      );
      if (!hasTargetYear) {
        console.log(`[hearings] no ${scrapeYear} month-headers visible — stopping`);
        break;
      }

      const hasNext = await page.$('a[title="Go to next page"], a:has-text("Next page")');
      if (!hasNext) break;
      pageNum++;
    }

    console.log(`[hearings] found ${eventUrls.size} notice(s) across all pages`);

    for (const eventUrl of eventUrls) {
      itemsFound++;
      console.log(`[hearings] visiting notice: ${eventUrl}`);

      await page.goto(eventUrl, { waitUntil: 'networkidle', timeout: 30_000 });

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
        console.log(`[hearings] skipping pre-${SCRAPE_FROM} notice (${meetingDate})`);
        continue;
      }

      const title = await page.evaluate(
        () =>
          document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'SF Planning Hearing Notice',
      );

      // Find PDF links on the notice page.
      const pdfLinks = await page.evaluate((): string[] =>
        [
          ...new Set(
            Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((h) => h.toLowerCase().endsWith('.pdf')),
          ),
        ],
      );

      // Snapshot the notice page HTML before following any links.
      const eventHtml = await page.content();

      // Start with the event page text, then append PDF text.
      let noticeText = htmlToText(eventHtml);
      let pdfsWithText = 0;

      for (const pdfUrl of pdfLinks.slice(0, 6)) {
        if (noticeText.length >= MAX_TEXT_TOTAL) break;
        try {
          const { bytes } = await fetchBytes(pdfUrl);
          const r = await extractPdfText(bytes);
          if (r.text) {
            pdfsWithText++;
            const label = pdfUrl.split('/').pop() ?? pdfUrl;
            noticeText += `\n--- ${label} ---\n${r.text.slice(0, MAX_TEXT_PER_PDF)}`;
          }
        } catch (err) {
          console.warn(
            `[hearings] PDF fetch failed ${pdfUrl}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (pdfLinks.length > 0 && pdfsWithText === 0) {
        console.warn(`[hearings] all ${pdfLinks.length} PDF(s) failed — using HTML text only`);
      }

      noticeText = noticeText.slice(0, MAX_TEXT_TOTAL);
      const needsOcr = noticeText.trim().length < 200;
      if (needsOcr) console.warn(`[hearings] needs OCR: ${eventUrl}`);

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId = eventUrl.split('/').pop() ?? null;

      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[hearings] already stored, skipping`);
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
        console.warn(`[hearings] storage upload failed, continuing:`, err);
      }

      const fullTitle = `SF Hearing Notice — ${title}`;

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: fullTitle,
        meeting_date: date,
        agenda_url: eventUrl,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: needsOcr,
      });

      if (insertErr) {
        if (insertErr.code === '23505') {
          console.log(`[hearings] duplicate insert skipped`);
        } else {
          console.error(`[hearings] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[hearings] ✓ stored: ${fullTitle} (${date})`);

      const { data: newRow } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .single();

      if (newRow?.id && !needsOcr) {
        await runLlmExtraction(supabase, newRow.id, fullTitle, noticeText);
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

    console.log(`[hearings] done — ${itemsNew} new / ${itemsFound} found`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('scrape_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: msg })
      .eq('id', runId);
    throw err;
  }
}

type SupabaseClient = ReturnType<typeof createAdminClient>;

async function runLlmExtraction(
  supabase: SupabaseClient,
  meetingId: string,
  meetingTitle: string,
  noticeText: string,
): Promise<void> {
  console.log(`[llm] extracting items for hearing notice ${meetingId}`);
  const { items, promptVersion, model } = await extractAgendaItems(noticeText, meetingTitle);

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
