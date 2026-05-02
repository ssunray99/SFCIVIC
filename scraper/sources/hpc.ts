import type { Page } from 'playwright';
import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { htmlToText } from '../lib/llm.ts';
import { persistExtractedItems } from '../lib/extract-pipeline.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'hpc';
const GRID_URL = 'https://sfplanning.org/hearings-historic-preservation-commission';
// HPC events live at /event/historic-preservation-commission-* on sfplanning.org.
const EVENT_URL_FRAGMENT = '/event/historic-preservation-commission';
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

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

    const eventUrls = new Set<string>();

    await page.goto(GRID_URL, { waitUntil: 'networkidle', timeout: 45_000 });

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
      console.log(`[hpc] switched grid to all-hearings descending (${page.url()})`);
    } else {
      console.warn('[hpc] could not switch grid filter — using upcoming-only default');
    }

    // Capture base URL before any page= param is added; re-reading inside the
    // loop accumulates page= params with each iteration.
    const baseGridUrl = page.url();

    const scrapeYear = Number(SCRAPE_FROM.slice(0, 4));
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];
    let pageNum = 0;
    let firstPage = true;

    while (true) {
      if (!firstPage) {
        const sep = baseGridUrl.includes('?') ? '&' : '?';
        const url = `${baseGridUrl}${sep}page=${pageNum}`;
        console.log(`[hpc] fetching grid page ${pageNum + 1}: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      } else {
        console.log(`[hpc] fetching grid page 1 (already loaded)`);
        firstPage = false;
      }

      const hrefs = await page.evaluate(
        (fragment: string) =>
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.includes(fragment)),
        EVENT_URL_FRAGMENT,
      );

      const before = eventUrls.size;
      for (const h of hrefs) eventUrls.add(h);
      const added = eventUrls.size - before;
      console.log(`[hpc] grid page ${pageNum + 1}: ${added} new event(s) (${eventUrls.size} total)`);

      if (added === 0) break;

      const hasTargetYear = await page.evaluate(
        ({ year, months }: { year: number; months: string[] }) =>
          months.some((m) => document.body.innerText.includes(`${m} ${year}`)),
        { year: scrapeYear, months: monthNames },
      );
      if (!hasTargetYear) {
        console.log(`[hpc] no ${scrapeYear} month-headers visible — stopping`);
        break;
      }

      const hasNext = await page.$('a[title="Go to next page"], a:has-text("Next page")');
      if (!hasNext) break;
      pageNum++;
    }

    console.log(`[hpc] found ${eventUrls.size} hearing event(s) across all pages`);

    for (const eventUrl of eventUrls) {
      itemsFound++;
      console.log(`[hpc] visiting event: ${eventUrl}`);

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

      if (meetingDate && meetingDate < SCRAPE_FROM) {
        console.log(`[hpc] skipping pre-${SCRAPE_FROM} meeting (${meetingDate})`);
        continue;
      }

      const title = await page.evaluate(
        (): string =>
          document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'SF Historic Preservation Commission Hearing',
      );

      const sectionLinks = await page.evaluate((): {
        agenda: string | null;
        supporting: string | null;
        minutes: string | null;
      } => {
        const out = {
          agenda: null as string | null,
          supporting: null as string | null,
          minutes: null as string | null,
        };
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href;
          const text = (a.textContent ?? '').trim().toLowerCase();
          if (text === 'agenda' && !out.agenda) out.agenda = href;
          else if (text === 'supporting' && !out.supporting) out.supporting = href;
          else if (text === 'minutes' && !out.minutes) out.minutes = href;
          if (!out.supporting && href.includes('/resource/historic-preservation-commission-hearing-packet-')) {
            out.supporting = href;
          }
        }
        return out;
      });

      const eventHtml = await page.content();

      const today = new Date().toISOString().slice(0, 10);
      const isPast = !!meetingDate && meetingDate < today;

      let agendaText = '';
      let needsOcr = false;
      let usedAnyPdf = false;
      let totalPdfsLinked = 0;

      if (isPast) {
        if (sectionLinks.agenda) {
          console.log(`[hpc] (past) agenda link: ${sectionLinks.agenda}`);
          const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE);
          agendaText += r.text;
          usedAnyPdf ||= r.pdfsWithText > 0;
          totalPdfsLinked += r.pdfsLinked;
        }
        if (sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
          console.log(`[hpc] (past) minutes link: ${sectionLinks.minutes}`);
          const remaining = MAX_TEXT_TOTAL - agendaText.length;
          const budget = Math.min(MAX_TEXT_PER_RESOURCE, remaining);
          const r = await gatherTextFromLink(page, sectionLinks.minutes, budget);
          if (r.text) agendaText += `\n\n======== MINUTES ========\n\n${r.text}`;
          usedAnyPdf ||= r.pdfsWithText > 0;
          totalPdfsLinked += r.pdfsLinked;
        }
      } else {
        if (sectionLinks.agenda) {
          console.log(`[hpc] (future) agenda link: ${sectionLinks.agenda}`);
          const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_TOTAL);
          agendaText += r.text;
          usedAnyPdf ||= r.pdfsWithText > 0;
          totalPdfsLinked += r.pdfsLinked;
        } else if (sectionLinks.supporting) {
          console.log(`[hpc] (future) supporting link: ${sectionLinks.supporting}`);
          const r = await gatherTextFromLink(page, sectionLinks.supporting, MAX_TEXT_TOTAL);
          agendaText += r.text;
          usedAnyPdf ||= r.pdfsWithText > 0;
          totalPdfsLinked += r.pdfsLinked;
        }
      }

      if (!agendaText.trim()) {
        agendaText = htmlToText(eventHtml);
      }

      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

      if (!usedAnyPdf && totalPdfsLinked > 0) {
        console.warn(`[hpc] all ${totalPdfsLinked} PDF(s) failed to parse — LLM will use HTML text only`);
      }
      needsOcr = agendaText.trim().length < 200;

      const bytes = Buffer.from(eventHtml);
      const mime = 'text/html' as const;

      const sourceUrl = isPast
        ? eventUrl
        : (sectionLinks.agenda ?? sectionLinks.supporting ?? eventUrl);
      const contentHash = sha256(bytes);

      if (needsOcr) console.warn(`[hpc] needs OCR: ${eventUrl}`);

      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[hpc] already stored, skipping`);
        continue;
      }

      let rawStoragePath: string | null = null;
      try {
        rawStoragePath = await uploadRaw({ sourceId: SOURCE_ID, contentHash, bytes, mime });
      } catch (err) {
        console.warn(`[hpc] storage upload failed, continuing:`, err);
      }

      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const externalId = eventUrl.split('/').pop()?.split('?')[0] ?? null;

      const { data: inserted, error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: `SF Historic Preservation Commission — ${title}`,
        meeting_date: date,
        agenda_url: sourceUrl,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: needsOcr,
      }).select('id').single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          console.log(`[hpc] content changed for ${externalId}, updating row`);
          const { data: existingRow } = await supabase
            .from('meetings')
            .select('id, needs_ocr')
            .eq('source_id', SOURCE_ID)
            .eq('external_id', externalId)
            .maybeSingle();

          if (existingRow) {
            await supabase
              .from('meetings')
              .update({
                content_hash: contentHash,
                raw_storage_path: rawStoragePath,
                needs_ocr: needsOcr,
                agenda_url: sourceUrl,
              })
              .eq('id', existingRow.id);

            if (!needsOcr) {
              const { count } = await supabase
                .from('agenda_items')
                .select('id', { count: 'exact', head: true })
                .eq('meeting_id', existingRow.id);

              if ((count ?? 0) === 0) {
                console.log(`[hpc] re-running LLM for updated meeting ${existingRow.id}`);
                await runLlmExtraction(supabase, existingRow.id, `SF Historic Preservation Commission — ${title}`, agendaText);
              } else {
                console.log(`[hpc] meeting ${existingRow.id} already has ${count} item(s), skipping LLM`);
              }
            }
          }
        } else {
          console.error(`[hpc] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[hpc] ✓ stored: ${title} (${date})`);

      const meetingId = inserted?.id ?? null;
      if (meetingId && !needsOcr) {
        await runLlmExtraction(supabase, meetingId, `SF Historic Preservation Commission — ${title}`, agendaText);
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

    console.log(`[hpc] done — ${itemsNew} new / ${itemsFound} found`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('scrape_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: msg })
      .eq('id', runId);
    throw err;
  }
}

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
      console.warn(`[hpc] PDF fetch failed ${url}:`, err instanceof Error ? err.message : err);
      return { text: '', pdfsLinked: 1, pdfsWithText: 0 };
    }
  }

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
    console.log(`[hpc] ${url} → ${pdfLinks.length} PDF(s)`);

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
        console.warn(`[hpc] PDF fetch/parse failed ${linkedPdf}:`, err instanceof Error ? err.message : err);
      }
    }

    return {
      text: parts.join('\n').slice(0, maxChars),
      pdfsLinked: pdfLinks.length,
      pdfsWithText,
    };
  } catch (err) {
    console.warn(`[hpc] resource page fetch failed ${url}:`, err instanceof Error ? err.message : err);
    return { text: '', pdfsLinked: 0, pdfsWithText: 0 };
  }
}

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

  console.log(`[hpc:extract] ${unprocessed.length} meeting(s) to process`);

  for (const meeting of unprocessed) {
    if (!meeting.raw_storage_path) {
      console.log(`[hpc:extract] no storage path for ${meeting.id}, skipping`);
      continue;
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('raw')
      .download(meeting.raw_storage_path);

    if (dlErr || !fileData) {
      console.warn(`[hpc:extract] download failed for ${meeting.id}:`, dlErr?.message);
      continue;
    }

    const bytes = Buffer.from(await fileData.arrayBuffer());
    const isHtml = meeting.raw_storage_path.endsWith('.html');
    const agendaText = isHtml
      ? htmlToText(bytes.toString('utf8'))
      : (await extractPdfText(bytes)).text;

    await runLlmExtraction(supabase, meeting.id, meeting.title, agendaText);
  }

  console.log(`[hpc:extract] done`);
}

async function runLlmExtraction(
  supabase: ReturnType<typeof createAdminClient>,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
): Promise<void> {
  await persistExtractedItems(supabase, meetingId, meetingTitle, agendaText);
}
