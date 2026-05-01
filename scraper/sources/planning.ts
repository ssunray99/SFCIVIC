import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'planning';
const GRID_URL = 'https://sfplanning.org/hearings-cpc-grid';
const BASE_URL = 'https://sfplanning.org';

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

    // Collect event URLs from all pages of the grid
    const eventUrls = new Set<string>();
    let pageNum = 0;
    while (true) {
      const url = pageNum === 0 ? GRID_URL : `${GRID_URL}?page=${pageNum}`;
      console.log(`[planning] fetching grid page ${pageNum + 1}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });

      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.includes('/event/planning-commission'))
      );

      const before = eventUrls.size;
      for (const h of hrefs) eventUrls.add(h);
      const added = eventUrls.size - before;
      console.log(`[planning] grid page ${pageNum + 1}: ${added} new event(s) (${eventUrls.size} total)`);

      // Stop if this page added nothing new (reached the end)
      if (added === 0) break;

      // Check if there's a next page
      const hasNext = await page.$('a[title="Go to next page"], a:has-text("Next page")');
      if (!hasNext) break;
      pageNum++;
    }

    console.log(`[planning] found ${eventUrls.size} hearing event(s) across all pages`);

    // Visit each event page to get the date, title, and agenda PDF
    for (const eventUrl of eventUrls) {
      itemsFound++;
      console.log(`[planning] visiting event: ${eventUrl}`);

      await page.goto(eventUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      // Extract meeting date from the page
      const meetingDate = await page.evaluate((): string | null => {
        // SF Planning event pages typically have a date in a <time> element or
        // a field labelled "Date" / "When"
        const time = document.querySelector('time[datetime]');
        if (time) {
          const dt = (time as HTMLTimeElement).dateTime;
          if (dt) return dt.slice(0, 10);
        }
        // Fallback: look for a date string in the page text
        const body = document.body.innerText;
        const m = body.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
        );
        if (m) {
          const d = new Date(m[0]);
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        return null;
      });

      // Get title
      const title = await page.evaluate((): string => {
        return (
          document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'SF Planning Commission Hearing'
        );
      });

      // Look for a PDF agenda link on the event page
      const pdfUrl = await page.evaluate((base: string): string | null => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).href.toLowerCase();
          const text = a.textContent?.toLowerCase() ?? '';
          if (href.endsWith('.pdf') || (href.includes(base) && text.includes('agenda'))) {
            return (a as HTMLAnchorElement).href;
          }
        }
        return null;
      }, BASE_URL);

      // Decide what to store: PDF if found, otherwise the event page HTML
      let bytes: Buffer;
      let mime: 'text/html' | 'application/pdf';
      let sourceUrl: string;

      if (pdfUrl) {
        console.log(`[planning] downloading agenda PDF: ${pdfUrl}`);
        try {
          ({ bytes, mime } = await fetchBytes(pdfUrl));
          sourceUrl = pdfUrl;
        } catch (err) {
          console.warn(`[planning] PDF fetch failed, falling back to HTML:`, err);
          bytes = Buffer.from(await page.content());
          mime = 'text/html';
          sourceUrl = eventUrl;
        }
      } else {
        console.log(`[planning] no PDF found — storing event page HTML`);
        bytes = Buffer.from(await page.content());
        mime = 'text/html';
        sourceUrl = eventUrl;
      }

      const contentHash = sha256(bytes);

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

      // Extract plain text for LLM
      let agendaText = '';
      let needsOcr = false;
      if (mime === 'application/pdf') {
        const result = await extractPdfText(bytes);
        agendaText = result.text;
        needsOcr = result.needsOcr;
        if (needsOcr) console.warn(`[planning] PDF likely scanned (needs OCR): ${sourceUrl}`);
      } else {
        agendaText = htmlToText(bytes.toString('utf8'));
      }

      // Upload to Storage
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

      // LLM extraction — runs immediately after storing the meeting
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
 * Re-run LLM extraction on all Planning Commission meetings that have no
 * agenda_items yet and aren't flagged needs_ocr.
 * Called by `npm run scrape:planning extract` or `npm run extract`.
 */
export async function extractExisting(): Promise<void> {
  const supabase = createAdminClient();

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, raw_storage_path, needs_ocr')
    .eq('source_id', SOURCE_ID)
    .eq('needs_ocr', false);

  if (error) throw error;

  // Filter to meetings with no agenda_items
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

    // Download raw bytes from Storage
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

// --- shared helper ---

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
