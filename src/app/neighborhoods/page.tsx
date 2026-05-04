import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { TileGrid, type Tile } from '@/components/TileGrid';
import { NEIGHBORHOODS } from '@/lib/constants';

export const revalidate = 300;

export const metadata = {
  title: 'Browse by Neighborhood — SF Civic Tracker',
  description: 'Find SF civic meetings with agenda items affecting your neighborhood.',
};

// Manual overrides:
// - HIDE: neighborhoods to exclude entirely until they get content.
const HIDE = new Set<string>(['Russian Hill']);

export default async function NeighborhoodsIndex() {
  const supabase = createServerClient();

  // Sort by item count (active neighborhoods float to the top), but include
  // every visible neighborhood — empty ones still link out.
  const { data } = await supabase
    .from('agenda_items')
    .select('neighborhoods')
    .not('neighborhoods', 'eq', '{}');

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const n of row.neighborhoods as string[]) {
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }

  const visible = NEIGHBORHOODS.filter((n) => !HIDE.has(n));
  const sorted = [...visible].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.localeCompare(b);
  });

  const tiles: Tile[] = sorted.map((n) => ({
    label: n,
    href: `/meetings?neighborhood=${encodeURIComponent(n)}&view=all`,
  }));

  return (
    <main className="mx-auto max-w-7xl px-10 py-12 flex flex-col gap-7">
      <Link
        href="/"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← Home
      </Link>

      <header className="flex flex-col gap-3">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 44, lineHeight: 1, fontWeight: 600 }}
        >
          Browse by Neighborhood
        </h1>
        <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Find SF civic meetings with agenda items affecting your neighborhood.
        </p>
      </header>

      <TileGrid tiles={tiles} />
    </main>
  );
}
