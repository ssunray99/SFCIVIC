import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'hearings';
const NOTICES_URL = 'https://sfplanning.org/permit/notices-legislative-amendments';
// Only import notices from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 30_000;
const MAX_TEXT_TOTAL = 80_000;

// Each notice on this page is filed for a specific Planning Commission hearing
// date. We store it as a 'hearings' meeting row with meeting_date = that PC
// hearing date so the frontend can correlate both records by date.
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

    await page.goto(NOTICES_URL, { waitUntil: 'networkidle', timeout: 45_000 });

    // Collect notice entries. The page may be a table or a list of links;
    // we gather every row / item that has a PDF link and a parseable date.
    type NoticeEntry = {
      title: string;
      hearingDate: string | null;
      pdfUrls: string[];
      detailUrl: string | null;
      pageUrl: string;
    };

    const entries: NoticeEntry[] = await page.evaluate((): NoticeEntry[] => {
      const results: NoticeEntry[] = [];
      const pageUrl = location.href;

      // Helper: parse "Month D, YYYY" or ISO date strings
      function parseDate(text: string): string | null {
        const m = text.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
        );
        if (m) {
          const d = new Date(m[0]);
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (iso) return iso[1];
        return null;
      }

      // Attempt 1: table rows (common Drupal views layout)
      const rows = Array.from(document.querySelectorAll('table tr, .views-row, .view-row'));

      for (const row of rows) {
        const text = (row as HTMLElement).innerText ?? '';
        const hearingDate = parseDate(text);
        const pdfs = Array.from(row.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.toLowerCase().endsWith('.pdf'));
        const detail = Array.from(row.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .find((h) => !h.toLowerCase().endsWith('.pdf') && h.includes('/permit/')) ?? null;
        const titleEl = row.querySelector('h2, h3, td:first-child, .views-field-title');
        const title = (titleEl as HTMLElement | null)?.innerText?.trim() ?? text.slice(0, 80);

        if (pdfs.length > 0 || detail) {
          results.push({ title, hearingDate, pdfUrls: pdfs, detailUrl: detail, pageUrl });
        }
      }

      // Attempt 2: if no rows found, collect all PDF links on the page with
      // surrounding context for date extraction.
      if (results.length === 0) {
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href;
          if (!href.toLowerCase().endsWith('.pdf')) continue;
          // Look for a date in the nearby text (parent and siblings)
          const parent = a.closest('li, tr, div, p') ?? a.parentElement;
          const context = (parent as HTMLElement | null)?.innerText ?? '';
          const hearingDate = parseDate(context);
          const title = (a.textContent ?? '').trim() || href.split('/').pop() ?? '';
          results.push({
            title,
            hearingDate,
            pdfUrls: [href],
            detailUrl: null,
            pageUrl,
          });
        }
      }

      return results;
    });

    console.log(`[hearings] found ${entries.length} notice entrie(s) on the listing page`);

    // Snapshot the listing page HTML as the canonical storage artefact.
    const listingHtml = await page.content();

    for (const entry of entries) {
      itemsFound++;

      // Skip if we can't determine a hearing date in the target year.
      if (!entry.hearingDate || entry.hearingDate < SCRAPE_FROM) {
        if (entry.hearingDate) {
          console.log(`[hearings] skipping pre-${SCRAPE_FROM} notice (${entry.hearingDate})`);
        } else {
          console.log(`[hearings] no date found for: ${entry.title.slice(0, 60)}`);
        }
        continue;
      }

      const hearingDate = entry.hearingDate;
      let noticeText = '';

      // Visit detail page if we have one and need more text.
      if (entry.detailUrl) {
        try {
          await page.goto(entry.detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });
          const detailHtml = await page.content();
          noticeText = htmlToText(detailHtml);

          // Also collect any additional PDF links from the detail page.
          const morePdfs = await page.evaluate((): string[] =>
            Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((h) => h.toLowerCase().endsWith('.pdf')),
          );
          for (const pdf of morePdfs) {
            if (!entry.pdfUrls.includes(pdf)) entry.pdfUrls.push(pdf);
          }
        } catch (err) {
          console.warn(
            `[hearings] detail page failed ${entry.detailUrl}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Download and parse PDFs.
      let pdfsWithText = 0;
      for (const pdfUrl of entry.pdfUrls.slice(0, 4)) {
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

      if (entry.pdfUrls.length > 0 && pdfsWithText === 0) {
        console.warn(
          `[hearings] all ${entry.pdfUrls.length} PDF(s) failed — using text only`,
        );
      }

      // Fall back to listing page HTML text if nothing else yielded content.
      if (!noticeText.trim()) {
        noticeText = htmlToText(listingHtml);
      }

      noticeText = noticeText.slice(0, MAX_TEXT_TOTAL);
      const needsOcr = noticeText.trim().length < 200;
      if (needsOcr) console.warn(`[hearings] needs OCR: ${entry.title}`);

      // Use the notice PDF URL (or detail page, or listing) as the agenda link.
      const agendaUrl = entry.pdfUrls[0] ?? entry.detailUrl ?? NOTICES_URL;

      const bytes = Buffer.from(
        // Stable key: combine the hearing date + first PDF URL so re-scraping
        // the listing page (which changes) doesn't re-insert the same notice.
        `${hearingDate}::${agendaUrl}`,
      );
      const contentHash = sha256(bytes);

      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[hearings] already stored, skipping (${hearingDate})`);
        continue;
      }

      // Store listing HTML as the raw artefact (stable canonical page).
      let rawStoragePath: string | null = null;
      try {
        const listingBytes = Buffer.from(listingHtml);
        const listingHash = sha256(listingBytes);
        rawStoragePath = await uploadRaw({
          sourceId: SOURCE_ID,
          contentHash: listingHash,
          bytes: listingBytes,
          mime: 'text/html',
        });
      } catch (err) {
        console.warn(`[hearings] storage upload failed, continuing:`, err);
      }

      const fullTitle = `SF Planning Legislative Notice — ${entry.title.trim()}`;
      const externalId = `${hearingDate}-${contentHash.slice(0, 8)}`;

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: fullTitle,
        meeting_date: hearingDate,
        agenda_url: agendaUrl,
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
      console.log(`[hearings] ✓ stored: ${fullTitle} (${hearingDate})`);

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
  console.log(`[llm] extracting items for legislative notice ${meetingId}`);
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
