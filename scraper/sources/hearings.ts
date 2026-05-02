import { newContext } from '../lib/playwright.ts';
import { sha256 } from '../lib/hash.ts';
import { uploadRaw } from '../lib/storage.ts';
import { extractAgendaItems } from '../lib/llm.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const SOURCE_ID = 'hearings';
const NOTICES_URL = 'https://sfplanning.org/permit/notices-legislative-amendments';
// Only import notices from this year onwards.
const SCRAPE_FROM = `${new Date().getFullYear()}-01-01`;

// The page is a single long document. Each section is headed by a date line
// like "March 12, 2026 - Planning Commission". The section body contains the
// full text of all legislative amendment notices for that hearing.
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

    // Extract each date section from the page DOM. Each section heading looks
    // like "March 12, 2026 - Planning Commission"; the content below it (until
    // the next heading) is the notices for that hearing.
    type Section = { heading: string; content: string; anchor: string };

    const sections = await page.evaluate((): Section[] => {
      const results: Section[] = [];
      const headings = Array.from(
        document.querySelectorAll('h2, h3, [class*="heading"], [class*="date"]'),
      ).filter((el) =>
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
          (el as HTMLElement).innerText ?? '',
        ),
      );

      for (const heading of headings) {
        const headingText = (heading as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
        const anchor = (heading as HTMLElement).id ?? '';
        let content = '';
        let el = heading.nextElementSibling;
        while (el) {
          const tag = el.tagName.toUpperCase();
          // Stop at the next date heading
          if (
            (tag === 'H2' || tag === 'H3') &&
            /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
              (el as HTMLElement).innerText ?? '',
            )
          ) break;
          content += (el as HTMLElement).innerText + '\n';
          el = el.nextElementSibling;
        }
        if (content.trim()) results.push({ heading: headingText, content: content.trim(), anchor });
      }
      return results;
    });

    console.log(`[hearings] found ${sections.length} date section(s) on the page`);

    const pageHtml = await page.content();
    await ctx.close();

    for (const section of sections) {
      // Parse the hearing date from the heading in Node.js.
      const m = section.heading.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
      );
      if (!m) {
        console.log(`[hearings] could not parse date from: "${section.heading}"`);
        continue;
      }
      const hearingDate = new Date(m[0]).toISOString().slice(0, 10);

      if (hearingDate < SCRAPE_FROM) {
        console.log(`[hearings] skipping pre-${SCRAPE_FROM} section (${hearingDate})`);
        continue;
      }

      itemsFound++;
      const externalId = `${hearingDate}-planning`;
      const noticeText = `${section.heading}\n\n${section.content}`;
      const contentHash = sha256(Buffer.from(noticeText));

      // Check by external_id (stable) OR content_hash (detects updates).
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .or(`external_id.eq.${externalId},content_hash.eq.${contentHash}`)
        .maybeSingle();

      if (existing) {
        console.log(`[hearings] already stored, skipping (${hearingDate})`);
        continue;
      }

      let rawStoragePath: string | null = null;
      try {
        const bytes = Buffer.from(pageHtml);
        const pageHash = sha256(bytes);
        rawStoragePath = await uploadRaw({
          sourceId: SOURCE_ID,
          contentHash: pageHash,
          bytes,
          mime: 'text/html',
        });
      } catch (err) {
        console.warn(`[hearings] storage upload failed, continuing:`, err);
      }

      const agendaUrl = section.anchor
        ? `${NOTICES_URL}#${section.anchor}`
        : NOTICES_URL;

      const fullTitle = `SF Planning Legislative Notice — ${section.heading}`;

      const { error: insertErr } = await supabase.from('meetings').insert({
        source_id: SOURCE_ID,
        external_id: externalId,
        title: fullTitle,
        meeting_date: hearingDate,
        agenda_url: agendaUrl,
        raw_storage_path: rawStoragePath,
        content_hash: contentHash,
        needs_ocr: false,
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
      console.log(`[hearings] ✓ stored: ${fullTitle}`);

      const { data: newRow } = await supabase
        .from('meetings')
        .select('id')
        .eq('source_id', SOURCE_ID)
        .eq('external_id', externalId)
        .single();

      if (newRow?.id) {
        await runLlmExtraction(supabase, newRow.id, fullTitle, noticeText);
      }
    }

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
