// Homepage — sleek, three-section landing.
//   1. Hero: ask anything (Claude-powered conversational search → /ask)
//   2. Explore: curated topic + neighborhood chips, plus address search
//   3. Browse: link cards for upcoming and past meetings (with live counts)

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { AskInput } from '@/components/AskInput';
import { AddressSearch } from '@/components/AddressSearch';

export const revalidate = 300;

// Curated subsets — the full lists are reachable via the "See all" links.
const FEATURED_TOPICS = [
  'housing',
  'zoning',
  'transit',
  'public-safety',
  'homelessness',
  'parks',
  'budget',
  'climate',
] as const;

const FEATURED_NEIGHBORHOODS = [
  'Mission',
  'SoMa',
  'Tenderloin',
  'Castro',
  'Bayview',
  'Chinatown',
  'Inner Sunset',
  'Outer Sunset',
] as const;

// Mirrors toSlug() in /neighborhoods/[slug]/page.tsx — lowercase, spaces→dashes,
// strip anything else. Without the final replace, names like "St. Francis Wood"
// would diverge between the two slug functions.
const slugify = (n: string) => n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

async function getMeetingCounts(): Promise<{ upcoming: number; past: number }> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const [up, pst] = await Promise.all([
    supabase.from('meetings').select('id', { count: 'exact', head: true }).gte('meeting_date', today),
    supabase.from('meetings').select('id', { count: 'exact', head: true }).lt('meeting_date', today),
  ]);
  return { upcoming: up.count ?? 0, past: pst.count ?? 0 };
}

export default async function Home() {
  const counts = await getMeetingCounts();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-14 px-6 py-12">
      {/* Hero */}
      <section className="flex flex-col gap-5 pt-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">SF Civic Tracker</h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Explore and search across the San Francisco civic process for topics and
            neighborhoods you care about.
          </p>
        </div>
        <AskInput size="lg" />
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Try:</span>
          {[
            "what's happening with housing in the Mission?",
            'budget items this month',
            'transit projects in District 6',
          ].map((s) => (
            <Link
              key={s}
              href={`/ask?q=${encodeURIComponent(s)}`}
              className="rounded-full border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              {s}
            </Link>
          ))}
        </div>
      </section>

      {/* Explore */}
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Explore</h2>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span className="uppercase tracking-wide">Topics</span>
            <Link href="/topics" className="hover:underline">
              See all →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {FEATURED_TOPICS.map((t) => (
              <Link
                key={t}
                href={`/topics/${t}`}
                className="rounded-full bg-zinc-100 px-3 py-1 text-sm capitalize text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {t.replace('-', ' ')}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span className="uppercase tracking-wide">Neighborhoods</span>
            <Link href="/neighborhoods" className="hover:underline">
              See all →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {FEATURED_NEIGHBORHOODS.map((n) => (
              <Link
                key={n}
                href={`/neighborhoods/${slugify(n)}`}
                className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {n}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Find by address
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Enter an SF address to see what&rsquo;s on the agenda for that neighborhood and district.
          </p>
          <AddressSearch />
        </div>
      </section>

      {/* Browse meetings */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Browse meetings</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/meetings"
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-5 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <div className="text-2xl font-semibold tabular-nums">{counts.upcoming}</div>
            <div className="text-sm font-medium">Upcoming meetings</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Hearings, ordinances, and votes coming up.
            </div>
          </Link>
          <Link
            href="/meetings?view=past"
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-5 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <div className="text-2xl font-semibold tabular-nums">{counts.past}</div>
            <div className="text-sm font-medium">Past meetings</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Agendas and outcomes from prior sessions.
            </div>
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/about" className="text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            About
          </Link>
        </div>
      </section>

      <footer className="mt-auto border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Unofficial. Summaries are AI-generated and may be wrong or incomplete. For
        canonical agendas see{' '}
        <a className="underline" href="https://sfplanning.org/hearings-commission" target="_blank" rel="noopener noreferrer">
          sfplanning.org
        </a>{' '}
        and{' '}
        <a className="underline" href="https://sfbos.org/meetings" target="_blank" rel="noopener noreferrer">
          sfbos.org
        </a>
        .
      </footer>
    </main>
  );
}
