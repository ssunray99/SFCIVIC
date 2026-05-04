import { createServerClient } from '@/lib/supabase/server';
import { NEIGHBORHOODS } from '@/lib/constants';

export const revalidate = 300;

export const metadata = {
  title: 'Browse by Neighborhood — SF Civic Tracker',
  description: 'Find SF civic meetings with agenda items affecting your neighborhood.',
};

function toSlug(n: string) {
  return n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export default async function NeighborhoodsIndex() {
  const supabase = createServerClient();

  // Fetch all neighborhoods arrays to count items per neighborhood.
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

  // Manual overrides:
  // - HIDE: neighborhoods to exclude entirely until they get content.
  // - FORCE_ACTIVE: neighborhoods that should render with the active style
  //   even if the count query happens to come back as 0 (e.g. items tagged
  //   under a sibling label).
  const HIDE = new Set<string>(['Russian Hill']);
  const FORCE_ACTIVE = new Set<string>(['Bernal Heights']);

  const visible = NEIGHBORHOODS.filter((n) => !HIDE.has(n));
  const sorted = visible.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All meetings
      </a>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Browse by Neighborhood</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Find SF civic meetings with agenda items affecting your neighborhood.
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sorted.map((n) => {
          const count = counts.get(n) ?? 0;
          const active = count > 0 || FORCE_ACTIVE.has(n);
          return (
            <li key={n}>
              <a
                href={`/neighborhoods/${toSlug(n)}`}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  active
                    ? 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
                    : 'border-zinc-100 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600'
                }`}
              >
                <span>{n}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Also browse{' '}
        <a href="/topics" className="underline">
          by topic
        </a>
        .
      </footer>
    </main>
  );
}
