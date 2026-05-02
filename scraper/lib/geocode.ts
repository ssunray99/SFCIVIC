// Geocoder for SF addresses extracted from agendas.
//
// Primary: Nominatim (OpenStreetMap) with an SF bounding box. Free, reliable,
// 1 req/sec usage limit — we honor it via a tiny in-process throttle.
// Cache: address_cache table keeps prior lookups so re-scrapes never re-hit.
//
// We don't use DataSF's address dataset directly; their Socrata search is
// fuzzy-match on the Enterprise Addressing System and most agenda addresses
// don't match exactly without custom normalization. Nominatim handles the
// fuzzy matching reliably for free.

import { createAdminClient } from '@/lib/supabase/admin.ts';

export type GeocodeResult = {
  lat: number;
  lng: number;
  source: 'nominatim' | 'cache';
};

// SF bounding box (loose) to filter Nominatim results.
const SF_BBOX = {
  minLat: 37.704,
  maxLat: 37.835,
  minLng: -122.524,
  maxLng: -122.354,
};

const USER_AGENT = 'sfcivic-tracker/0.1 (https://github.com/ssunray99/SFCIVIC)';

let lastNominatimAt = 0;
async function nominatimThrottle() {
  const elapsed = Date.now() - lastNominatimAt;
  const wait = 1100 - elapsed;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}

/** Normalize address to a stable cache key. Lowercase, collapse whitespace. */
export function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\broad\b/g, 'rd')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchNominatim(address: string): Promise<GeocodeResult | null> {
  await nominatimThrottle();
  const q = encodeURIComponent(`${address}, San Francisco, CA`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1&countrycodes=us`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) {
      console.warn(`[geocode] nominatim http ${resp.status} for "${address}"`);
      return null;
    }
    const json = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (json.length === 0) return null;
    const lat = parseFloat(json[0].lat);
    const lng = parseFloat(json[0].lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < SF_BBOX.minLat ||
      lat > SF_BBOX.maxLat ||
      lng < SF_BBOX.minLng ||
      lng > SF_BBOX.maxLng
    ) {
      return null; // outside SF — drop
    }
    return { lat, lng, source: 'nominatim' };
  } catch (err) {
    console.warn(`[geocode] nominatim fetch failed for "${address}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Geocode a raw address string. Cache-first; on miss, calls Nominatim and
 * writes the result (or absence) to address_cache so the next call is free.
 */
export async function geocodeAddress(raw: string): Promise<GeocodeResult | null> {
  const norm = normalizeAddress(raw);
  if (norm.length < 4) return null;

  const supabase = createAdminClient();

  const { data: cached } = await supabase
    .from('address_cache')
    .select('lat, lng, source')
    .eq('address_norm', norm)
    .maybeSingle();

  if (cached) {
    if (cached.lat == null || cached.lng == null) return null; // negative cache
    return { lat: cached.lat, lng: cached.lng, source: 'cache' };
  }

  const fresh = await fetchNominatim(norm);

  // Upsert (positive or negative). lat/lng null = "we tried, no result".
  await supabase.from('address_cache').upsert({
    address_norm: norm,
    lat: fresh?.lat ?? null,
    lng: fresh?.lng ?? null,
    source: fresh?.source ?? 'nominatim',
  });

  return fresh;
}
