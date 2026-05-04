import { createAdminClient } from '@/lib/supabase/admin.ts';

function pct(n: number, d: number) {
  return d === 0 ? '0%' : Math.round((100 * n) / d) + '%';
}

async function main() {
const supabase = createAdminClient();

// Pull up to 5000 items with their meeting's source_id
const { data: raw, error } = await (supabase as any)
  .from('agenda_items')
  .select('id, title, neighborhoods, district, topics, meetings(source_id)')
  .limit(5000);

if (error) { console.error(error); process.exit(1); }

const items = (raw ?? []).map((r: any) => ({
  id: r.id,
  title: r.title,
  neighborhoods: r.neighborhoods ?? [],
  district: r.district,
  topics: r.topics ?? [],
  source_id: r.meetings?.source_id ?? 'unknown',
}));

console.log(`\nTotal items sampled: ${items.length}`);

// ── 1. Tagging rates by source ──────────────────────────────────────────────
const sources = ([...new Set(items.map((i: any) => i.source_id as string))] as string[]).sort();
console.log('\n=== TAGGING RATES BY SOURCE ===');
console.log('source                         | items | nbhd       | district   | topics');
console.log('-------------------------------|-------|------------|------------|----------');
for (const src of sources) {
  const rows = items.filter((i: any) => i.source_id === src);
  const wN = rows.filter((i: any) => i.neighborhoods.length > 0).length;
  const wD = rows.filter((i: any) => i.district !== null).length;
  const wT = rows.filter((i: any) => i.topics.length > 0).length;
  console.log(
    `${src.padEnd(30)} | ${String(rows.length).padStart(5)} | ${pct(wN,rows.length).padStart(4)} (${String(wN).padStart(4)}) | ${pct(wD,rows.length).padStart(4)} (${String(wD).padStart(4)}) | ${pct(wT,rows.length).padStart(4)} (${String(wT).padStart(4)})`,
  );
}

// ── 2. Neighbourhood distribution ───────────────────────────────────────────
console.log('\n=== NEIGHBORHOOD DISTRIBUTION (top 20) ===');
const nCounts = new Map<string, number>();
for (const i of items) for (const n of i.neighborhoods) nCounts.set(n, (nCounts.get(n) ?? 0) + 1);
[...nCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([n, c]) => console.log(`  ${String(c).padStart(4)}  ${n}`));

// ── 3. Topic distribution ────────────────────────────────────────────────────
console.log('\n=== TOPIC DISTRIBUTION ===');
const tCounts = new Map<string, number>();
for (const i of items) for (const t of i.topics) tCounts.set(t, (tCounts.get(t) ?? 0) + 1);
[...tCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([t, c]) => console.log(`  ${String(c).padStart(4)}  ${t}`));

// ── 4. District distribution ─────────────────────────────────────────────────
console.log('\n=== DISTRICT DISTRIBUTION ===');
const dCounts = new Map<number, number>();
for (const i of items) if (i.district !== null) dCounts.set(i.district, (dCounts.get(i.district) ?? 0) + 1);
[...dCounts.entries()]
  .sort((a, b) => a[0] - b[0])
  .forEach(([d, c]) => console.log(`  D${d}: ${c}`));

// ── 5. Items with multiple neighbourhoods ────────────────────────────────────
const multi = items.filter((i: any) => i.neighborhoods.length > 1);
console.log(`\n=== ITEMS WITH MULTIPLE NEIGHBORHOODS: ${multi.length} / ${items.length} (${pct(multi.length, items.length)}) ===`);

// ── 6. Fully untagged items (no neighborhood, no district, no topic) ─────────
const untagged = items.filter((i: any) => i.neighborhoods.length === 0 && i.district === null && i.topics.length === 0);
console.log(`\n=== FULLY UNTAGGED ITEMS (no nbhd, no district, no topic): ${untagged.length} / ${items.length} (${pct(untagged.length, items.length)}) ===`);
untagged.slice(0, 10).forEach((i: any) => console.log(`  [${i.source_id}] ${i.title?.slice(0, 80)}`));

// ── 7. Sample: tagged items to sanity-check quality ──────────────────────────
console.log('\n=== SAMPLE TAGGED ITEMS (random 10 with neighborhoods) ===');
const tagged = items.filter((i: any) => i.neighborhoods.length > 0);
const sample = tagged.sort(() => Math.random() - 0.5).slice(0, 10);
for (const i of sample) {
  console.log(`  [${i.source_id}] nbhd=${i.neighborhoods.join(',')} D${i.district} topics=${i.topics.join(',')||'none'}`);
  console.log(`    "${i.title?.slice(0, 90)}"`);
}
}

main().catch(console.error);
