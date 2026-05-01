import { newContext, fetchBytes } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { extractPdfText } from '../lib/pdf.ts';
import { uploadRaw } from '../lib/storage.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'planning';
const HEARINGS_URL = 'https://sfplanning.org/hearings-cpc';

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
    await page.goto(HEARINGS_URL, { waitUntil: 'networkidle', timeout: 45_000 });

    const allAnchors = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: a.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        rowText: (
          a.closest('tr') ??
          a.closest('li') ??
          a.closest('article') ??
          a.closest('div') ??
          a.parentElement
        )?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      }));
    });

    console.log(`[planning] page has ${allAnchors.length} total anchors`);

    const agendaLinks = allAnchors.filter(({ href, text }) => {
      const h = href.toLowerCase();
      const t = text.toLowerCase();
      return h.endsWith('.pdf') || h.includes('/agenda') || t.includes('agenda');
    });

    console.log(`[planning] found ${agendaLinks.length} agenda link(s)`);

    // Always dump all anchors for now so we can see the full page structure
    if (true || agendaLinks.length === 0) {
      const debugDir = 'scraper/.debug';
      const fs = await import('node:fs/promises');
      await fs.mkdir(debugDir, { recursive: true });
      const html = await page.content();
      await fs.writeFile(`${debugDir}/planning.html`, html);
      await page.screenshot({ path: `${debugDir}/planning.png`, fullPage: true });
      console.warn(`[planning] no agenda links found. Wrote ${debugDir}/planning.html and planning.png`);
      console.warn(`[planning] all ${allAnchors.length} anchor samples:`);
      for (const a of allAnchors) {
        console.warn(`  - ${a.href} :: "${a.text.slice(0, 60)}"`);
      }
    }

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
