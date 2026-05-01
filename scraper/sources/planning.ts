import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'planning';
const HEARINGS_URL = 'https://sfplanning.org/hearings-commission';

export async function scrape(): Promise<void> {
  const supabase = createAdminClient();

  // --- log scrape start ---
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

    console.log(`[planning] navigating to ${HEARINGS_URL}`);
    await page.goto(HEARINGS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // SF Planning typically renders hearing rows as <tr> elements with a date
    // and an "Agenda" link. We look for any <a> whose href ends in .pdf or
    // whose text includes "agenda" (case-insensitive).
    const agendaLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .filter((a) => {
          const href = (a as HTMLAnchorElement).href.toLowerCase();
          const text = a.textContent?.toLowerCase() ?? '';
          return (
            href.endsWith('.pdf') ||
            href.includes('/agenda') ||
            text.includes('agenda')
          );
        })
        .map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim() ?? '',
          // Walk up to a <tr> or <li> to get adjacent date text
          rowText: (
            a.closest('tr') ??
            a.closest('li') ??
            a.closest('div') ??
            a.parentElement
          )?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        }));
    });

    console.log(`[planning] found ${agendaLinks.length} agenda link(s)`);

    for (const link of agendaLinks) {
      const url = link.href;
      console.log(`[planning] fetching ${url}`);

      let bytes: Buffer;
      let mime: 'text/html' | 'application/pdf';

      try {
        ({ bytes, mime } = await fetchBytes(url));
      } catch (err) {
        console.warn(`[planning] fetch failed: ${url}`, err);
        continue;
      }

      const contentHash = sha256(bytes);
      itemsFound++;

      // Idempotency: skip if we've already stored this exact content
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[planning] already stored (hash match), skipping`);
        continue;
      }

      // Extract text for later LLM use
      let agendaText = '';
      let needsOcr = false;
      if (mime === 'application/pdf') {
        ({ text: agendaText, needsOcr } = await extractPdfText(bytes));
        if (needsOcr) {
          console.warn(`[planning] PDF text too short — likely scanned: ${url}`);
        }
      } else {
        agendaText = bytes.toString('utf8');
      }

      // Upload raw bytes to Supabase Storage
      let rawStoragePath: string | null = null;
      try {
        rawStoragePath = await uploadRaw({ sourceId: SOURCE_ID, contentHash, bytes, mime });
      } catch (err) {
        console.warn(`[planning] storage upload failed, continuing anyway:`, err);
      }

      // Parse a date from the row text or URL (best-effort)
      const meetingDate = parseDateFromText(link.rowText) ?? parseDateFromUrl(url) ?? new Date().toISOString().slice(0, 10);
      const title = buildTitle(link.rowText, meetingDate);

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        title,
        meeting_date: meetingDate,
        agenda_url: url,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: needsOcr,
      });

      if (insertErr) {
        // unique constraint violation = race condition, not a real error
        if (insertErr.code === '23505') {
          console.log(`[planning] duplicate insert skipped`);
        } else {
          console.error(`[planning] insert error:`, insertErr.message);
        }
        continue;
      }

      itemsNew++;
      console.log(`[planning] ✓ stored: ${title} (${meetingDate})`);
    }

    await ctx.close();

    await supabase
      .from('scrape_runs')
      .update({ status: 'success', finished_at: new Date().toISOString(), items_found: itemsFound, items_new: itemsNew })
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

// --- helpers ---

function parseDateFromText(text: string): string | null {
  // Matches patterns like "May 1, 2026", "January 15, 2026", "2026-01-15"
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const d = new Date(m[0]);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function parseDateFromUrl(url: string): string | null {
  const m = url.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function buildTitle(rowText: string, date: string): string {
  // Use the first meaningful chunk of the row text, falling back to a generic title
  const clean = rowText.replace(/\s+/g, ' ').trim();
  if (clean.length > 10 && clean.length < 200) return `SF Planning Commission Hearing — ${clean.slice(0, 100)}`;
  return `SF Planning Commission Hearing — ${date}`;
}
