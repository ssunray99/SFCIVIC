import Link from 'next/link';
import { TileGrid, type Tile } from '@/components/TileGrid';
import { TOPICS } from '@/lib/constants';

export const metadata = {
  title: 'Browse by Topic — SF Civic Tracker',
  description: 'Find SF civic meetings with agenda items on the issues you care about.',
};

const humanize = (t: string) =>
  t.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export default function TopicsIndex() {
  const tiles: Tile[] = [...TOPICS]
    .sort((a, b) => a.localeCompare(b))
    .map((t) => ({
      label: humanize(t),
      href: `/meetings?topic=${t}&view=all`,
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
          Browse by Topic
        </h1>
        <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Find SF civic meetings with agenda items on the issues you care about.
        </p>
      </header>

      <TileGrid tiles={tiles} />
    </main>
  );
}
