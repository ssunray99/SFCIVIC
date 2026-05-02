// One-shot script to download SF neighborhood + supervisor-district GeoJSON
// polygons from DataSF into scraper/data/. Run with: npm run fetch:geo.
//
// Source datasets (DataSF Socrata geospatial export):
//   - Analysis Neighborhoods (4x4: ajp5-b2md, ~1.4 MB)
//   - Current Supervisor Districts (4x4: keex-zmn4, ~460 KB)
//
// These are public, no auth required.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const TARGETS = [
  {
    file: 'neighborhoods.geojson',
    url: 'https://data.sfgov.org/api/geospatial/ajp5-b2md?method=export&format=GeoJSON',
    label: 'Analysis Neighborhoods',
  },
  {
    file: 'districts.geojson',
    url: 'https://data.sfgov.org/api/geospatial/keex-zmn4?method=export&format=GeoJSON',
    label: 'Current Supervisor Districts',
  },
];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  for (const t of TARGETS) {
    process.stdout.write(`[fetch-geo] ${t.label}... `);
    const resp = await fetch(t.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${t.url}`);
    const text = await resp.text();
    const json = JSON.parse(text);
    if (!json.features || !Array.isArray(json.features) || json.features.length === 0) {
      throw new Error(`Empty FeatureCollection from ${t.url}`);
    }
    writeFileSync(join(DATA_DIR, t.file), text);
    console.log(`${json.features.length} features → ${t.file}`);
  }
}

main().catch((err) => {
  console.error('[fetch-geo] failed:', err);
  process.exit(1);
});
