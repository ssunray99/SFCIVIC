// Point-in-polygon + haversine helpers for SF neighborhood / district lookup.
// Assets live in scraper/data/{neighborhoods,districts}.geojson and are loaded
// once on first call; both files are bundled with the repo.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Neighborhood } from '@/lib/constants.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

type Ring = number[][];                 // [[lng, lat], ...]
type Polygon = Ring[];                  // [outerRing, ...holes]
type MultiPolygon = Polygon[];

type Feature<P> = {
  type: 'Feature';
  properties: P;
  geometry:
    | { type: 'Polygon'; coordinates: Polygon }
    | { type: 'MultiPolygon'; coordinates: MultiPolygon };
};

type FC<P> = { type: 'FeatureCollection'; features: Feature<P>[] };

// DataSF "Analysis Neighborhoods" → our enum (src/lib/constants.ts).
// Names not in this map are dropped; the LLM-derived neighborhood tag is
// used instead. Keep this aligned with NEIGHBORHOODS.
const DATASF_TO_ENUM: Record<string, Neighborhood> = {
  'Bayview Hunters Point': 'Bayview',
  'Bernal Heights': 'Bernal Heights',
  'Castro/Upper Market': 'Castro',
  'Chinatown': 'Chinatown',
  'Excelsior': 'Excelsior',
  'Financial District': 'Financial District',
  'Glen Park': 'Glen Park',
  'Haight Ashbury': 'Haight',
  'Hayes Valley': 'Hayes Valley',
  'Inner Richmond': 'Inner Richmond',
  'Inner Sunset': 'Inner Sunset',
  'Marina': 'Marina',
  'Mission': 'Mission',
  'Mission Bay': 'Mission Bay',
  'Nob Hill': 'Nob Hill',
  'Noe Valley': 'Noe Valley',
  'North Beach': 'North Beach',
  'Outer Richmond': 'Outer Richmond',
  'Sunset/Parkside': 'Outer Sunset',
  'Pacific Heights': 'Pacific Heights',
  'Portola': 'Portola',
  'Potrero Hill': 'Potrero Hill',
  'Presidio': 'Presidio',
  'Russian Hill': 'Russian Hill',
  'South of Market': 'SoMa',
  'Tenderloin': 'Tenderloin',
  'Treasure Island': 'Treasure Island',
  'Twin Peaks': 'Twin Peaks',
  'Visitacion Valley': 'Visitacion Valley',
  'West of Twin Peaks': 'West Portal',
  'Western Addition': 'Western Addition',
  // Unmapped (return null): Golden Gate Park, Japantown, Lakeshore, Lincoln Park,
  // Lone Mountain/USF, McLaren Park, Oceanview/Merced/Ingleside, Outer Mission,
  // Presidio Heights, Seacliff. LLM-derived neighborhood tags still apply.
};

let _neighborhoods: FC<{ nhood?: string; name?: string }> | null = null;
let _districts: FC<{ supervisor?: number | string; sup_dist_num?: number | string; district?: number | string }> | null = null;

function loadNeighborhoods(): FC<{ nhood?: string; name?: string }> {
  if (!_neighborhoods) {
    const buf = readFileSync(join(DATA_DIR, 'neighborhoods.geojson'), 'utf8');
    _neighborhoods = JSON.parse(buf);
  }
  return _neighborhoods!;
}

function loadDistricts(): FC<{ supervisor?: number | string; sup_dist_num?: number | string; district?: number | string }> {
  if (!_districts) {
    const buf = readFileSync(join(DATA_DIR, 'districts.geojson'), 'utf8');
    _districts = JSON.parse(buf);
  }
  return _districts!;
}

/** Ray-casting: returns true if [lng, lat] is inside the closed polygon ring. */
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  if (polygon.length === 0) return false;
  if (!pointInRing(lng, lat, polygon[0])) return false;
  // any hit on a hole disqualifies
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false;
  }
  return true;
}

function pointInFeatureGeometry(lng: number, lat: number, geom: Feature<unknown>['geometry']): boolean {
  if (geom.type === 'Polygon') return pointInPolygon(lng, lat, geom.coordinates);
  for (const poly of geom.coordinates) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

/** Resolve (lat, lng) to one of our enum neighborhoods, or null if outside SF. */
export function neighborhoodFromPoint(lat: number, lng: number): Neighborhood | null {
  const fc = loadNeighborhoods();
  for (const f of fc.features) {
    if (!pointInFeatureGeometry(lng, lat, f.geometry)) continue;
    const raw = (f.properties.nhood ?? f.properties.name ?? '').trim();
    const mapped = DATASF_TO_ENUM[raw];
    if (mapped) return mapped;
  }
  return null;
}

/** Resolve (lat, lng) to a supervisor district 1-11, or null if outside SF. */
export function districtFromPoint(lat: number, lng: number): number | null {
  const fc = loadDistricts();
  for (const f of fc.features) {
    if (!pointInFeatureGeometry(lng, lat, f.geometry)) continue;
    const raw =
      f.properties.supervisor ??
      f.properties.sup_dist_num ??
      f.properties.district ??
      null;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 11) return n;
  }
  return null;
}

const EARTH_R_MI = 3958.7613;

/** Great-circle distance in miles between two (lat,lng) points. */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return 2 * EARTH_R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bounding box for a radius in miles around (lat,lng). Use as SQL prefilter. */
export function bboxMiles(center: { lat: number; lng: number }, radiusMiles: number) {
  const dLat = radiusMiles / 69; // deg latitude per mile (constant ~69)
  const dLng = radiusMiles / (Math.cos((center.lat * Math.PI) / 180) * 69);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}
