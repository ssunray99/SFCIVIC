import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'planning';
const GRID_URL = 'https://sfplanning.org/hearings-cpc-grid';
// Only import meetings from this year onwards. Past years are excluded both
// during grid pagination (stop when year disappears from the page) and when
// inserting each event (skip if meeting_date is before Jan 1 of this year).
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

// Per-meeting text budget when feeding the LLM.
const MAX_PDFS_PER_RESOURCE = 12;
const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_PER_RESOURCE = 80_000;
const MAX_TEXT_TOTAL = 120_000;

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

    // Collect event URLs. The grid defaults to "Upcoming Hearings"; we switch
    // it to show all hearings (the "- Any -" option) so past meetings in the
    // current year are included. We also switch sort to Descending so that the
    // most recent meetings appear first and we can stop once we pass Jan 1.
    const eventUrls = new Set<string>();

    await page.goto(GRID_URL, { waitUntil: 'networkidle', timeout: 45_000 });

    // Switch the timing filter to "all" and sort to descending, then Apply.
    // If the selects aren't found the page stays in its default state and we
    // fall back to upcoming-only behaviour — no harm done.
    const filterApplied = await page.evaluate((): boolean => {
      let changed = false;

      for (const sel of Array.from(document.querySelectorAll('select'))) {
        const opts = Array.from(sel.options);

        // Timing filter: switch from "Upcoming Hearings" to "- Any -" / "All"
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

        // Sort filter: switch from "Ascending" to "Descending" so newest
        // events come first and we can stop once the year rolls back.
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
      // Click the Apply/APPLY button and wait for the filtered results.
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 45_000 }),
        page.click(
          'input[type="submit"][value="Apply"], ' +
          'input[type="submit"][value="APPLY"], ' +
          'button[type="submit"]',
        ),
      ]);
      console.log(`[planning] switched grid to all-hearings descending (${page.url()})`);
    } else {
      console.warn('[planning] could not switch grid filter — using upcoming-only default');
    }

    // Paginate through the (now filtered + sorted) grid. Since the sort is
    // descending, newest meetings are first. Stop once a page shows no dates
    // from SCRAPE_FROM's year — that means we've scrolled past the year boundary.
    const scrapeYear = Number(SCRAPE_FROM.slice(0, 4));
    let pageNum = 0;
    let firstPage = true;

    while (true) {
      if (!firstPage) {
        const sep = page.url().includes('?') ? '&' : '?';
        const url = `${page.url()}${sep}page=${pageNum}`;
        console.log(`[planning] fetching grid page ${pageNum + 1}: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      } else {
        console.log(`[planning] fetching grid page 1 (already loaded)`);
        firstPage = false;
      }

      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.includes('/event/planning-commission')),
      );

      const before = eventUrls.size;
      for (const h of hrefs) eventUrls.add(h);
      const added = eventUrls.size - before;
      console.log(`[planning] grid page ${pageNum + 1}: ${added} new event(s) (${eventUrls.size} total)`);

      if (added === 0) break;

      // Stop if this page contains no text from the target year — we've
      // scrolled past the Jan 1 boundary into the prior year.
      const hasTargetYear = await page.evaluate(
        (year: number) => new RegExp(`\\b${year}\\b`).test(document.body.innerText),
        scrapeYear,
      );
      if (!hasTargetYear) {
        console.log(`[planning] no ${scrapeYear} events visible — stopping grid pagination`);
        break;
      }

      const hasNext = await page.$('a[title="Go to next page"], a:has-text("Next page")');
      if (!hasNext) break;
      pageNum++;
    }

    console.log(`[planning] found ${eventUrls.size} hearing event(s) across all pages`);

    for (const eventUrl of eventUrls) {
      itemsFound++;
      console.log(`[planning] visiting event: ${eventUrl}`);

      await page.goto(eventUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      const meetingDate = await page.evaluate((): string | null => {
        const time = document.querySelector('time[datetime]');
        if (time) {
          const dt = (time as HTMLTimeElement).dateTime;
          if (dt) return dt.slice(0, 10);
        }
        const body = document.body.innerText;
        const m = body.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
        );
        if (m) {
          const d = new Date(m[0]);
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        return null;
      });

      // Skip meetings outside the target year — may appear on the last
      // paginated grid page which can straddle the year boundary.
      if (meetingDate && meetingDate < SCRAPE_FROM) {
        console.log(`[planning] skipping pre-${SCRAPE_FROM} meeting (${meetingDate})`);
        continue;
      }

      const title = await page.evaluate(
        (): string =>
          document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'SF Planning Commission Hearing',
      );

      // Find the AGENDA and SUPPORTING buttons by their visible text. Newer
      // events only have SUPPORTING (the "hearing packet"); older events have
      // both AGENDA (the canonical agenda doc) and SUPPORTING (staff reports).
      const sectionLinks = await page.evaluate((): {
        agenda: string | null;
        supporting: string | null;
      } => {
        const out = { agenda: null as string | null, supporting: null as string | null };
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href;
          const text = (a.textContent ?? '').trim().toLowerCase();
          if (text === 'agenda' && !out.agenda) out.agenda = href;
          else if (text === 'supporting' && !out.supporting) out.supporting = href;
          // Fallback URL pattern for the SUPPORTING packet
          if (!out.supporting && href.includes('/resource/planning-commission-hearing-packet-')) {
            out.supporting = href;
          }
        }
        return out;
      });

      // Snapshot event HTML now — page navigates away when we follow links.
      const eventHtml = await page.content();

      // Pull text from each linked resource. Agenda gets priority budget.
      let agendaText = '';
      let needsOcr = false;
      let usedAnyPdf = false;
      let totalPdfsLinked = 0;

      if (sectionLinks.agenda) {
        console.log(`[planning] agenda link: ${sectionLinks.agenda}`);
        const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE);
        agendaText += r.text;
        usedAnyPdf ||= r.pdfsWithText > 0;
        totalPdfsLinked += r.pdfsLinked;
      }

      if (sectionLinks.supporting && agendaText.length < MAX_TEXT_TOTAL) {
        console.log(`[planning] supporting link: ${sectionLinks.supporting}`);
        const remaining = MAX_TEXT_TOTAL - agendaText.length;
        const budget = Math.min(MAX_TEXT_PER_RESOURCE, remaining);
        const r = await gatherTextFromLink(page, sectionLinks.supporting, budget);
        if (r.text) agendaText += `\n\n========\n\n${r.text}`;
        usedAnyPdf ||= r.pdfsWithText > 0;
        totalPdfsLinked += r.pdfsLinked;
      }

      // Fall back to event-page text if we found neither section.
      if (!agendaText.trim()) {
        agendaText = htmlToText(eventHtml);
      }

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

      // Only skip LLM if there is truly nothing useful to send — i.e. the
      // final text is shorter than the minimum the LLM requires (200 chars).
      // PDF parse failures alone are not enough reason to block: the packet
      // HTML often has case titles and descriptions worth extracting.
      if (!usedAnyPdf && totalPdfsLinked > 0) {
        console.warn(`[planning] all ${totalPdfsLinked} PDF(s) failed to parse — LLM will use HTML text only`);
      }
      needsOcr = agendaText.trim().length < 200;

      // Store the event page HTML as the canonical raw artefact. It is the
      // single stable URL for a meeting and contains links to every PDF.
      const bytes = Buffer.from(eventHtml);
      const mime = 'text/html' as const;
      const sourceUrl = sectionLinks.agenda ?? sectionLinks.supporting ?? eventUrl;
      const contentHash = sha256(bytes);

      if (needsOcr) console.warn(`[planning] needs OCR: ${eventUrl}`);

      // Idempotency check
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[planning] already stored, skipping`);
        continue;
      }

      let rawStoragePath: string | null = null;
      try {
        rawStoragePath = await uploadRaw({ sourceId: SOURCE_ID, contentHash, bytes, mime });
      } catch (err) {
        console.warn(`[planning] storage upload failed, continuing:`, err);
      }

      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId = eventUrl.split('/').pop() ?? null;

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: `SF Planning Commission — ${title}`,
        meeting_date: date,
        agenda_url: sourceUrl,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: needsOcr,
      });

      if (insertErr) {
        if (insertErr.code === '23505') {
          console.log(`[planning] duplicate insert skipped`);
        } else {
          console.error(`[planning] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[planning] ✓ stored: ${title} (${date})`);

      const meetingId = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .single()
        .then(({ data }) => data?.id ?? null);

      if (meetingId && !needsOcr) {
        await runLlmExtraction(supabase, meetingId, `SF Planning Commission — ${title}`, agendaText);
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

    console.log(`[planning] done — ${itemsNew} new / ${itemsFound} found`);
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
 * Fetch text from a planning.org link, which may be either:
 *   - a direct PDF (downloaded + parsed), or
 *   - a /resource/ HTML page that lists multiple PDF children (visited, then
 *     each linked PDF is downloaded + parsed and concatenated).
 *
 * Returns the gathered text plus stats so the caller can flag needs_ocr when
 * a meeting linked PDFs but none yielded extractable text.
 */
async function gatherTextFromLink(
  page: Page,
  url: string,
  maxChars: number,
): Promise<{ text: string; pdfsLinked: number; pdfsWithText: number }> {
  if (url.toLowerCase().endsWith('.pdf')) {
    try {
      const { bytes } = await fetchBytes(url);
      const r = await extractPdfText(bytes);
      const trimmed = r.text.slice(0, maxChars);
      return {
        text: trimmed,
        pdfsLinked: 1,
        pdfsWithText: trimmed.length > 0 ? 1 : 0,
      };
    } catch (err) {
      console.warn(`[planning] PDF fetch failed ${url}:`, err instanceof Error ? err.message : err);
      return { text: '', pdfsLinked: 1, pdfsWithText: 0 };
    }
  }

  // /resource/ page — visit it, then download each linked PDF
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
    console.log(`[planning] ${url} → ${pdfLinks.length} PDF(s)`);

    const parts: string[] = [htmlToText(html)];
    let totalLen = parts[0].length;
    let pdfsWithText = 0;

    for (const linkedPdf of pdfLinks.slice(0, MAX_PDFS_PER_RESOURCE)) {
      if (totalLen >= maxChars) break;
      try {
        const { bytes } = await fetchBytes(linkedPdf);
        const r = await extractPdfText(bytes);
        if (r.text) {
          pdfsWithText++;
          const label = linkedPdf.split('/').pop() ?? linkedPdf;
          const block = `\n--- ${label} ---\n${r.text.slice(0, MAX_TEXT_PER_PDF)}`;
          parts.push(block);
          totalLen += block.length;
        }
      } catch (err) {
        console.warn(`[planning] PDF fetch/parse failed ${linkedPdf}:`, err instanceof Error ? err.message : err);
      }
    }

    return {
      text: parts.join('\n').slice(0, maxChars),
      pdfsLinked: pdfLinks.length,
      pdfsWithText,
    };
  } catch (err) {
    console.warn(`[planning] resource page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return { text: '', pdfsLinked: 0, pdfsWithText: 0 };
  }
}

/**
 * Re-run LLM extraction on all Planning Commission meetings that have no
 * agenda_items yet and aren't flagged needs_ocr. Reads the stored event-page
 * HTML from Storage — note this only contains links, not PDF content, so
 * re-extraction of older rows produces weaker results than a fresh scrape.
 */
export async function extractExisting(): Promise<void> {
  const supabase = createAdminClient();

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, raw_storage_path, needs_ocr')
    .eq('source_id', SOURCE_ID)
    .eq('needs_ocr', false);

  if (error) throw error;

  const unprocessed: typeof meetings = [];
  for (const m of meetings ?? []) {
    const { count } = await supabase
      .from('agenda_items')
      .select('id', { count: 'exact', head: true })
      .eq('meeting_id', m.id);
    if ((count ?? 0) === 0) unprocessed.push(m);
  }

  console.log(`[planning:extract] ${unprocessed.length} meeting(s) to process`);

  for (const meeting of unprocessed) {
    if (!meeting.raw_storage_path) {
      console.log(`[planning:extract] no storage path for ${meeting.id}, skipping`);
      continue;
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('raw')
      .download(meeting.raw_storage_path);

    if (dlErr || !fileData) {
      console.warn(`[planning:extract] download failed for ${meeting.id}:`, dlErr?.message);
      continue;
    }

    const bytes = Buffer.from(await fileData.arrayBuffer());
    const isHtml = meeting.raw_storage_path.endsWith('.html');
    const agendaText = isHtml
      ? htmlToText(bytes.toString('utf8'))
      : (await extractPdfText(bytes)).text;

    await runLlmExtraction(supabase, meeting.id, meeting.title, agendaText);
  }

  console.log(`[planning:extract] done`);
}

type SupabaseClient = ReturnType<typeof createAdminClient>;

async function runLlmExtraction(
  supabase: SupabaseClient,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
): Promise<void> {
  console.log(`[llm] extracting items for meeting ${meetingId}`);
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
