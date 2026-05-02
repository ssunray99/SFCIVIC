import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems, htmlToText } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'bos';
const BASE_URL = 'https://sfbos.org';
const MEETINGS_URL = `${BASE_URL}/meetings`;
// Only import meetings from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

const MAX_TEXT_PER_PDF = 20_000;
const MAX_TEXT_TOTAL = 100_000;

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

    // Visit the meetings hub to collect two sets of links in one pass:
    //   1. sectionLinks — internal sub-pages to walk for meeting detail links
    //   2. directMeetingLinks — links on this page that already look like meetings
    await page.goto(MEETINGS_URL, { waitUntil: 'networkidle', timeout: 45_000 });

    const scrapeYear = new Date().getFullYear();

    const { sectionLinks, directMeetingLinks } = await page.evaluate(
      (base: string, year: number): { sectionLinks: string[]; directMeetingLinks: string[] } => {
        const all = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter(
            (href) =>
              href.startsWith(base + '/') &&
              !href.includes('#') &&
              !href.includes('?'),
          );

        const looksLikeMeeting = (href: string) =>
          href.includes(String(year)) || /agenda|meeting/i.test(href);

        const direct = [...new Set(all.filter(looksLikeMeeting))];
        const sections = [...new Set(all.filter((h) => !looksLikeMeeting(h)))];

        return { sectionLinks: sections, directMeetingLinks: direct };
      },
      BASE_URL,
      scrapeYear,
    );

    console.log(
      `[bos] meetings hub: ${sectionLinks.length} section link(s), ` +
        `${directMeetingLinks.length} direct meeting link(s)`,
    );

    // Seed the candidate set with any direct meeting links found on the hub.
    const meetingUrls = new Set<string>(directMeetingLinks);

    // Walk each section page to collect additional meeting detail URLs.
    for (const sectionUrl of sectionLinks.slice(0, 30)) {
      try {
        await page.goto(sectionUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        const links = await page.evaluate(
          (base: string, year: number): string[] =>
            Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter(
                (href) =>
                  href.startsWith(base + '/') &&
                  (href.includes(String(year)) || /agenda|meeting/i.test(href)),
              ),
          BASE_URL,
          scrapeYear,
        );
        for (const l of links) meetingUrls.add(l);
      } catch {
        // Section unavailable — skip silently.
      }
    }

    // Drop the hub itself and obvious non-content URLs.
    meetingUrls.delete(MEETINGS_URL);
    for (const u of [...meetingUrls]) {
      if (u.endsWith('/meetings') || /\.(pdf|jpg|png|gif|css|js)$/i.test(u)) {
        meetingUrls.delete(u);
      }
    }

    console.log(`[bos] ${meetingUrls.size} candidate meeting URL(s) to inspect`);

    for (const meetingUrl of meetingUrls) {
      itemsFound++;
      console.log(`[bos] visiting: ${meetingUrl}`);

      let meetingDate: string | null = null;
      let title = '';
      let agendaText = '';
      let eventHtml = '';

      try {
        await page.goto(meetingUrl, { waitUntil: 'networkidle', timeout: 30_000 });

        meetingDate = await page.evaluate((): string | null => {
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

        title = await page.evaluate(
          () =>
            document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
            'SF Board of Supervisors Meeting',
        );

        // Find PDF links on the meeting page.
        const pdfLinks = await page.evaluate((): string[] =>
          [
            ...new Set(
              Array.from(document.querySelectorAll('a[href]'))
                .map((a) => (a as HTMLAnchorElement).href)
                .filter((h) => h.toLowerCase().endsWith('.pdf')),
            ),
          ],
        );

        eventHtml = await page.content();
        agendaText = htmlToText(eventHtml);

        for (const pdfUrl of pdfLinks.slice(0, 8)) {
          if (agendaText.length >= MAX_TEXT_TOTAL) break;
          try {
            const { bytes } = await fetchBytes(pdfUrl);
            const r = await extractPdfText(bytes);
            if (r.text) {
              const label = pdfUrl.split('/').pop() ?? pdfUrl;
              agendaText += `\n--- ${label} ---\n${r.text.slice(0, MAX_TEXT_PER_PDF)}`;
            }
          } catch (err) {
            console.warn(
              `[bos] PDF fetch failed ${pdfUrl}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[bos] page load failed ${meetingUrl}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);
      const needsOcr = agendaText.trim().length < 200;
      if (needsOcr) console.warn(`[bos] needs OCR or too short: ${meetingUrl}`);

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId =
        meetingUrl.replace(BASE_URL + '/', '').replace(/\//g, '-') || null;

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
        agenda_url: meetingUrl,
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
