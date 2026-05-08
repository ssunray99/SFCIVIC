// Shared LLM-extraction + geocoding pipeline used by every source scraper.
//
// Inputs: meeting id, title, gathered text, optional gather stats (scanned-PDF
// bytes for multimodal fallback, fetch warnings, expected/fetched PDF counts).
//
// Outputs: rows persisted to agenda_items + agenda_item_locations and the
// meetings.extraction_status state-machine column transitioned to one of:
//   - success: extraction returned items and gather had no warnings
//   - partial: extraction ran but some PDFs failed to fetch / parse, OR the
//              meeting genuinely had no items but text was sparse
//   - failed:  LLM threw after retries (and multimodal fallback also failed)
//
// Idempotency: persistExtractedItems deletes any prior agenda_items for the
// meeting before re-inserting, so re-running under a new prompt version
// replaces v3 rows with v4 cleanly.

import {
  extractAgendaItems,
  extractAgendaItemsMultimodal,
  type ExtractedItem,
  type ExtractionResult,
} from './llm.ts';
import { PROMPT_VERSION } from '../prompts/extract.ts';
import { geocodeAddress } from './geocode.ts';
import { neighborhoodFromPoint, districtFromPoint } from './geo.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import type { Neighborhood } from '@/lib/constants.ts';

type SupabaseClient = ReturnType<typeof createAdminClient>;

export type GatherStats = {
  /** PDFs whose text-only parse came back empty/garbage; we'll send the bytes
   *  to Gemini multimodal as a fallback. */
  scannedPdfs?: Array<{ label: string; bytes: Buffer }>;
  /** Per-link failure messages collected during gather; surfaced on
   *  meetings.fetch_warnings for /analytics dashboards. */
  fetchWarnings?: string[];
  /** Total PDFs the source linked from the event page. */
  expectedPdfCount?: number;
  /** Of those, how many were successfully fetched. */
  fetchedPdfCount?: number;
};

type ResolvedLocation = {
  raw_address: string;
  lat: number | null;
  lng: number | null;
  neighborhood: Neighborhood | null;
  district: number | null;
  geocode_source: string;
};

type EnrichedItem = ExtractedItem & {
  resolvedNeighborhoods: Neighborhood[];   // LLM ∪ polygon-derived
  resolvedDistrict: number | null;         // LLM, else first polygon hit
  locations: ResolvedLocation[];
};

/**
 * Idempotency probe: returns whether a meeting with this content_hash has
 * already been successfully extracted under the current prompt version.
 *
 * Each source calls this before doing any expensive PDF gather. If `fresh`
 * is true, skip the meeting entirely. If `existingId` is non-null but
 * `fresh` is false, the row exists but extraction is incomplete / stale —
 * re-run extraction for that meeting_id.
 */
export async function checkMeetingFreshness(
  supabase: SupabaseClient,
  sourceId: string,
  contentHash: string,
): Promise<{ fresh: boolean; existingId: string | null; status: string | null }> {
  const { data } = await supabase
    .from('meetings')
    .select('id, extraction_status, last_prompt_version')
    .eq('source_id', sourceId)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (!data) return { fresh: false, existingId: null, status: null };
  const row = data as { id: string; extraction_status: string; last_prompt_version: string | null };
  const fresh = row.extraction_status === 'success' && row.last_prompt_version === PROMPT_VERSION;
  return { fresh, existingId: row.id, status: row.extraction_status };
}

async function enrichItem(item: ExtractedItem): Promise<EnrichedItem> {
  const locations: ResolvedLocation[] = [];
  const polygonNeighborhoods: Neighborhood[] = [];
  let polygonDistrict: number | null = null;

  // De-dup raw addresses within an item — agendas often list "1234 Mission St"
  // multiple times in one block.
  const seen = new Set<string>();
  const unique = item.addresses.filter((a) => {
    const key = a.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const raw of unique) {
    const result = await geocodeAddress(raw);
    if (!result) {
      locations.push({
        raw_address: raw,
        lat: null,
        lng: null,
        neighborhood: null,
        district: null,
        geocode_source: 'failed',
      });
      continue;
    }
    const nbhd = neighborhoodFromPoint(result.lat, result.lng);
    const dist = districtFromPoint(result.lat, result.lng);
    if (nbhd && !polygonNeighborhoods.includes(nbhd)) polygonNeighborhoods.push(nbhd);
    if (polygonDistrict == null && dist != null) polygonDistrict = dist;
    locations.push({
      raw_address: raw,
      lat: result.lat,
      lng: result.lng,
      neighborhood: nbhd,
      district: dist,
      geocode_source: result.source,
    });
  }

  const merged = [...item.neighborhoods];
  for (const n of polygonNeighborhoods) {
    if (!merged.includes(n)) merged.push(n);
  }

  return {
    ...item,
    resolvedNeighborhoods: merged,
    resolvedDistrict: item.district ?? polygonDistrict,
    locations,
  };
}

/**
 * Persist already-extracted items. Use when you've called extractAgendaItems
 * yourself (e.g., to inspect items before committing destructive operations).
 * For the standard scrape path, prefer persistExtractedItems below.
 *
 * Replaces any prior agenda_items for meetingId so re-extracting under a new
 * prompt_version cleanly supersedes the old rows. To prevent accidental wipes
 * when the new extraction comes back empty (LLM hiccup, transient gather
 * failure), the delete is skipped if items is empty AND the meeting already
 * has items. The caller marks status='partial' in that branch so the next
 * scrape retries.
 */
export async function persistItems(
  supabase: SupabaseClient,
  meetingId: string,
  items: ExtractedItem[],
  promptVersion: string,
  model: string,
): Promise<{ inserted: number; locations: number; preservedExisting: boolean }> {
  if (items.length === 0) {
    // Don't wipe pre-existing items just because this extraction returned
    // nothing — that's the failure mode that turns a transient LLM hiccup
    // into permanent data loss. Check first; only declare "no items" if
    // there were also none before.
    const { count } = await supabase
      .from('agenda_items')
      .select('*', { count: 'exact', head: true })
      .eq('meeting_id', meetingId);
    const preExisting = count ?? 0;
    if (preExisting > 0) {
      console.warn(
        `[extract] new extraction returned 0 items but ${preExisting} item(s) already exist for ${meetingId}; preserving existing rows`,
      );
      return { inserted: 0, locations: 0, preservedExisting: true };
    }
    console.log(`[extract] no items for ${meetingId}`);
    return { inserted: 0, locations: 0, preservedExisting: false };
  }

  // We have new items — replace prior rows. Cheap (delete-by-meeting_id
  // hits the index) and atomic enough for our use case.
  await supabase.from('agenda_items').delete().eq('meeting_id', meetingId);

  const enriched: EnrichedItem[] = [];
  for (const item of items) enriched.push(await enrichItem(item));

  const now = new Date().toISOString();
  const itemRows = enriched.map((item) => ({
    meeting_id: meetingId,
    position: item.position ?? null,
    title: item.title,
    summary: item.summary,
    item_type: item.item_type,
    district: item.resolvedDistrict,
    neighborhoods: item.resolvedNeighborhoods,
    topics: item.topics,
    comment_deadline: item.comment_deadline,
    comment_email: item.comment_email,
    comment_portal_url: item.comment_portal_url,
    in_person_slot: item.in_person_slot,
    matter_file_number: item.matter_file_number,
    llm_model: model,
    prompt_version: promptVersion,
    llm_extracted_at: now,
  }));

  const { data: inserted, error } = await supabase
    .from('agenda_items')
    .insert(itemRows)
    .select('id');

  if (error || !inserted) {
    console.error(`[extract] agenda_items insert failed for ${meetingId}:`, error?.message);
    return { inserted: 0, locations: 0, preservedExisting: false };
  }

  // Pair inserted item IDs back with their resolved locations and bulk-insert.
  const locationRows: Array<{
    agenda_item_id: string;
    raw_address: string;
    lat: number | null;
    lng: number | null;
    neighborhood: string | null;
    district: number | null;
    geocoded_at: string;
    geocode_source: string;
  }> = [];

  for (let i = 0; i < inserted.length; i++) {
    const itemId = inserted[i].id;
    for (const loc of enriched[i].locations) {
      locationRows.push({
        agenda_item_id: itemId,
        raw_address: loc.raw_address,
        lat: loc.lat,
        lng: loc.lng,
        neighborhood: loc.neighborhood,
        district: loc.district,
        geocoded_at: now,
        geocode_source: loc.geocode_source,
      });
    }
  }

  if (locationRows.length > 0) {
    const { error: locErr } = await supabase.from('agenda_item_locations').insert(locationRows);
    if (locErr) {
      console.error(`[extract] agenda_item_locations insert failed for ${meetingId}:`, locErr.message);
    }
  }

  console.log(
    `[extract] ✓ ${inserted.length} item(s), ${locationRows.length} location(s) for ${meetingId}`,
  );
  return { inserted: inserted.length, locations: locationRows.length, preservedExisting: false };
}

/**
 * Standard scrape path: extract via LLM (with multimodal fallback for scanned
 * PDFs) and persist + transition extraction_status in one call.
 *
 * Status transitions:
 *   success — items extracted, no fetch warnings, all linked PDFs fetched
 *   partial — items extracted (or zero items), but gather had warnings or
 *             some linked PDFs failed
 *   failed  — LLM threw after retries AND multimodal fallback also failed
 */
export async function persistExtractedItems(
  supabase: SupabaseClient,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
  gatherStats?: GatherStats,
): Promise<void> {
  console.log(`[extract] running for meeting ${meetingId}`);
  const scannedPdfs = gatherStats?.scannedPdfs ?? [];
  const fetchWarnings = gatherStats?.fetchWarnings ?? [];
  const expected = gatherStats?.expectedPdfCount ?? null;
  const fetched = gatherStats?.fetchedPdfCount ?? null;

  // Bump attempt counter + record gather stats now, so partial gathers are
  // visible on /analytics even if extraction throws below.
  // (Read-then-update: there's a TOCTOU race if two scrapers ever process
  // the same meeting in parallel, but the scraper is serial today and the
  // counter is informational, not a correctness primitive.)
  const { data: cur } = await supabase
    .from('meetings')
    .select('extraction_attempt_count')
    .eq('id', meetingId)
    .single();
  const nextAttempt =
    ((cur as { extraction_attempt_count?: number } | null)?.extraction_attempt_count ?? 0) + 1;

  await supabase
    .from('meetings')
    .update({
      extraction_attempt_count: nextAttempt,
      fetch_warnings: fetchWarnings,
      expected_pdf_count: expected,
      fetched_pdf_count: fetched,
      last_extracted_at: new Date().toISOString(),
    })
    .eq('id', meetingId);

  let result: ExtractionResult | null = null;
  let lastError: string | null = null;

  try {
    result = await extractAgendaItems(agendaText, meetingTitle);
    // Multimodal fallback: if we have scanned PDFs and the text-only pass
    // returned a thin or empty result, try again with the PDF bytes attached
    // and union the items.
    if (scannedPdfs.length > 0 && result.items.length < 3) {
      console.log(
        `[extract] text pass returned ${result.items.length} item(s); ` +
        `retrying with multimodal (${scannedPdfs.length} scanned PDF(s))`,
      );
      try {
        const mm = await extractAgendaItemsMultimodal(agendaText, scannedPdfs, meetingTitle);
        result = mergeResults(result, mm);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[extract] multimodal pass failed; keeping text-only result: ${msg}`);
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[extract] LLM extraction failed for ${meetingId}: ${lastError}`);
    if (scannedPdfs.length > 0) {
      try {
        result = await extractAgendaItemsMultimodal(agendaText, scannedPdfs, meetingTitle);
        lastError = null;
      } catch (mmErr) {
        const mmMsg = mmErr instanceof Error ? mmErr.message : String(mmErr);
        lastError = `text: ${lastError}; multimodal: ${mmMsg}`;
      }
    }
  }

  if (!result || (lastError && result.items.length === 0)) {
    await setStatus(supabase, meetingId, 'failed', lastError ?? 'unknown extraction failure', null);
    return;
  }

  const persistResult = await persistItems(
    supabase,
    meetingId,
    result.items,
    result.promptVersion,
    result.model,
  );

  // If persistItems preserved existing items (new extraction returned 0 but
  // previous rows were kept), mark partial so a future scrape retries
  // instead of locking the meeting at status='success' with stale items.
  if (persistResult.preservedExisting) {
    await setStatus(
      supabase,
      meetingId,
      'partial',
      'new extraction returned 0 items; preserved existing rows for retry',
      null, // intentionally not stamping last_prompt_version=v4 — those rows are still v3
    );
    return;
  }

  const isPartial =
    fetchWarnings.length > 0 ||
    (expected !== null && fetched !== null && fetched < expected);

  await setStatus(
    supabase,
    meetingId,
    isPartial ? 'partial' : 'success',
    null,
    result.promptVersion,
  );
}

function mergeResults(a: ExtractionResult, b: ExtractionResult): ExtractionResult {
  // Use title (lowercased + collapsed whitespace) as the dedupe key. Same
  // legislative item sometimes appears with slightly different positions in
  // text vs scanned passes, but the title is stable.
  const seen = new Set<string>();
  const merged: ExtractedItem[] = [];
  for (const item of [...a.items, ...b.items]) {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return { items: merged, promptVersion: a.promptVersion, model: a.model };
}

async function setStatus(
  supabase: SupabaseClient,
  meetingId: string,
  status: 'success' | 'partial' | 'failed',
  error: string | null,
  promptVersion: string | null,
): Promise<void> {
  const update: Record<string, unknown> = {
    extraction_status: status,
    extraction_error: error,
  };
  if (promptVersion) update.last_prompt_version = promptVersion;
  await supabase.from('meetings').update(update).eq('id', meetingId);
}
