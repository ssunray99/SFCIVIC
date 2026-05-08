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

const SOURCE_ID = 'hpc';
// sfplanning.org renamed the HPC grid URL in 2026: the old
// `hearings-historic-preservation-commission` slug now 404s; the canonical
// path is `hearings-hpc` (which redirects to `hearings-hpc-grid`). The event
// URL pattern itself is unchanged — `/event/historic-preservation-commission-NNN`.
const GRID_URL = 'https://sfplanning.org/hearings-hpc';
const EVENT_URL_FRAGMENT = '/event/historic-preservation-commission';
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

// Caps lifted in v4 (Gemini 1M-token window).
const MAX_PDFS_PER_RESOURCE = 12;
const MAX_TEXT_PER_PDF = 100_000;
const MAX_TEXT_PER_RESOURCE = 400_000;
const MAX_TEXT_TOTAL = 500_000;

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
          const text = (a.textContent ?? '').trim();
          if (!href || /INSERTLINK/i.test(href)) continue;
          if (!out.agenda && /^agenda(\s*\(?pdf\)?)?$/i.test(text)) out.agenda = href;
          else if (!out.supporting && /^supporting(\s*\(?pdf\)?)?$/i.test(text)) out.supporting = href;
          else if (!out.minutes && /^minutes(\s*\(?pdf\)?)?$/i.test(text)) out.minutes = href;
          if (!out.supporting && href.includes('/resource/historic-preservation-commission-hearing-packet-')) {
            out.supporting = href;
          }
        }
        return out;
      });

      const eventHtml = await page.content();

      const today = new Date().toISOString().slice(0, 10);
      const isPast = !!meetingDate && meetingDate < today;

      const bytes = Buffer.from(eventHtml);
      const contentHash = sha256(bytes);
      const externalId = eventUrl.split('/').pop()?.split('?')[0] ?? null;

      const freshness = await checkMeetingFreshness(supabase, SOURCE_ID, contentHash);
      if (freshness.fresh) {
        console.log(`[hpc] already stored + extracted, skipping`);
        continue;
      }
      if (freshness.existingId) {
        console.log(`[hpc] re-extracting existing meeting (status=${freshness.status})`);
      }

      // v4: include SUPPORTING for past meetings (see planning.ts comment).
      const stats: GatherStats = {
        scannedPdfs: [],
        fetchWarnings: [],
        expectedPdfCount: 0,
        fetchedPdfCount: 0,
      };
      let agendaText = '';

      if (isPast) {
        if (sectionLinks.agenda) {
          console.log(`[hpc] (past) agenda link: ${sectionLinks.agenda}`);
          const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_PER_RESOURCE, stats);
          agendaText += r.text;
        }
        if (sectionLinks.minutes && agendaText.length < MAX_TEXT_TOTAL) {
          console.log(`[hpc] (past) minutes link: ${sectionLinks.minutes}`);
          const remaining = MAX_TEXT_TOTAL - agendaText.length;
          const budget = Math.min(MAX_TEXT_PER_RESOURCE, remaining);
          const r = await gatherTextFromLink(page, sectionLinks.minutes, budget, stats);
          if (r.text) agendaText += `\n\n======== MINUTES ========\n\n${r.text}`;
        }
        if (sectionLinks.supporting && agendaText.length < MAX_TEXT_TOTAL) {
          console.log(`[hpc] (past) supporting link: ${sectionLinks.supporting}`);
          const remaining = MAX_TEXT_TOTAL - agendaText.length;
          const budget = Math.min(MAX_TEXT_PER_RESOURCE, remaining);
          const r = await gatherTextFromLink(page, sectionLinks.supporting, budget, stats);
          if (r.text) agendaText += `\n\n======== SUPPORTING / STAFF REPORTS ========\n\n${r.text}`;
        }
      } else {
        if (sectionLinks.agenda) {
          console.log(`[hpc] (future) agenda link: ${sectionLinks.agenda}`);
          const r = await gatherTextFromLink(page, sectionLinks.agenda, MAX_TEXT_TOTAL, stats);
          agendaText += r.text;
        } else if (sectionLinks.supporting) {
          console.log(`[hpc] (future) supporting link: ${sectionLinks.supporting}`);
          const r = await gatherTextFromLink(page, sectionLinks.supporting, MAX_TEXT_TOTAL, stats);
          agendaText += r.text;
        }
      }

      if (!agendaText.trim()) agendaText = htmlToText(eventHtml);
      agendaText = agendaText.slice(0, MAX_TEXT_TOTAL);

      const sourceUrl = isPast
        ? eventUrl
        : (sectionLinks.agenda ?? sectionLinks.supporting ?? eventUrl);
      const date = meetingDate ?? new Date().toISOString().slice(0, 10);
      const fullTitle = `SF Historic Preservation Commission — ${title}`;

      let meetingId: string | null = freshness.existingId;

      if (!meetingId) {
        let rawStoragePath: string | null = null;
        try {
          rawStoragePath = await uploadRaw({ sourceId: SOURCE_ID, contentHash, bytes, mime: 'text/html' });
        } catch (err) {
          console.warn(`[hpc] storage upload failed, continuing:`, err);
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
            console.log(`[hpc] content changed for ${externalId}, updating row`);
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
                  needs_ocr: stats.scannedPdfs!.length > 0,
                  agenda_url: sourceUrl,
                })
                .eq('id', existingRow.id);
              meetingId = existingRow.id;
            }
          } else {
            console.error(`[hpc] insert error:`, insertErr.message);
            continue;
          }
        } else {
          meetingId = inserted?.id ?? null;
          itemsNew++;
          console.log(`[hpc] ✓ stored: ${title} (${date})`);
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
  stats: GatherStats,
): Promise<{ text: string }> {
  if (url.toLowerCase().endsWith('.pdf')) {
    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + 1;
    const r = await fetchBytes(url);
    if (!r.ok) {
      stats.fetchWarnings!.push(`${url}: ${r.message}`);
      console.warn(`[hpc] PDF fetch failed ${url}: ${r.message}`);
      return { text: '' };
    }
    stats.fetchedPdfCount = (stats.fetchedPdfCount ?? 0) + 1;
    const parsed = await extractPdfText(r.bytes);
    if (parsed.needsOcr || !parsed.text) {
      const label = url.split('/').pop() ?? url;
      stats.scannedPdfs!.push({ label, bytes: r.bytes });
      stats.fetchWarnings!.push(`${url}: scanned/OCR-only PDF`);
    }
    return { text: parsed.text.slice(0, maxChars) };
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

    stats.expectedPdfCount = (stats.expectedPdfCount ?? 0) + pdfLinks.length;

    const parts: string[] = [htmlToText(html)];
    let totalLen = parts[0].length;

    for (const linkedPdf of pdfLinks.slice(0, MAX_PDFS_PER_RESOURCE)) {
      if (totalLen >= maxChars) break;
      const r = await fetchBytes(linkedPdf);
      if (!r.ok) {
        stats.fetchWarnings!.push(`${linkedPdf}: ${r.message}`);
        console.warn(`[hpc] PDF fetch failed ${linkedPdf}: ${r.message}`);
        continue;
      }
      stats.fetchedPdfCount = (stats.fetchedPdfCount ?? 0) + 1;
      const parsed = await extractPdfText(r.bytes);
      if (parsed.needsOcr || !parsed.text) {
        const label = linkedPdf.split('/').pop() ?? linkedPdf;
        stats.scannedPdfs!.push({ label, bytes: r.bytes });
        stats.fetchWarnings!.push(`${linkedPdf}: scanned/OCR-only PDF`);
      }
      if (parsed.text) {
        const label = linkedPdf.split('/').pop() ?? linkedPdf;
        const block = `\n--- ${label} ---\n${parsed.text.slice(0, MAX_TEXT_PER_PDF)}`;
        parts.push(block);
        totalLen += block.length;
      }
    }

    return { text: parts.join('\n').slice(0, maxChars) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fetchWarnings!.push(`${url}: ${msg}`);
    console.warn(`[hpc] resource page fetch failed ${url}: ${msg}`);
    return { text: '' };
  }
}

export async function extractExisting(): Promise<void> {
  const supabase = createAdminClient();

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, raw_storage_path, extraction_status')
    .eq('source_id', SOURCE_ID)
    .neq('extraction_status', 'success');

  if (error) throw error;

  console.log(`[hpc:extract] ${meetings?.length ?? 0} meeting(s) to process`);

  for (const meeting of meetings ?? []) {
    if (!meeting.raw_storage_path) continue;
    const { data: fileData } = await supabase.storage.from('raw').download(meeting.raw_storage_path);
    if (!fileData) continue;
    const bytes = Buffer.from(await fileData.arrayBuffer());
    const isHtml = meeting.raw_storage_path.endsWith('.html');
    const agendaText = isHtml ? htmlToText(bytes.toString('utf8')) : (await extractPdfText(bytes)).text;
    await persistExtractedItems(supabase, meeting.id, meeting.title, agendaText);
  }

  console.log(`[hpc:extract] done`);
}
