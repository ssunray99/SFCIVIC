// Shared LLM-extraction + geocoding pipeline used by every source scraper.
// Inputs: a meeting's id, title, and gathered agenda text.
// Outputs: rows persisted to agenda_items and agenda_item_locations.

import { extractAgendaItems, type ExtractedItem } from './llm.ts';
import { geocodeAddress } from './geocode.ts';
import { neighborhoodFromPoint, districtFromPoint } from './geo.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import type { Neighborhood } from '@/lib/constants.ts';

type SupabaseClient = ReturnType<typeof createAdminClient>;

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

export async function persistExtractedItems(
  supabase: SupabaseClient,
  meetingId: string,
  meetingTitle: string,
  agendaText: string,
): Promise<void> {
  console.log(`[extract] running for meeting ${meetingId}`);
  const { items, promptVersion, model } = await extractAgendaItems(agendaText, meetingTitle);

  if (items.length === 0) {
    console.log(`[extract] no items for ${meetingId}`);
    return;
  }

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
    return;
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
}
