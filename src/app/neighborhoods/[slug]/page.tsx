import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { NEIGHBORHOODS, type Neighborhood } from '@/lib/constants';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';

export const revalidate = 300;

const SELECT = `
  id,
  source_id,
  title,
  meeting_date,
  agenda_url,
  needs_ocr,
  agenda_items (
    id,
    position,
    title,
    summary,
    item_type,
    district,
    neighborhoods,
    topics,
    comment_deadline,
    comment_email,
    comment_portal_url,
    in_person_slot,
    matter_file_number
  )
`;

function toSlug(n: string) {
  return n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function fromSlug(slug: string): Neighborhood | null {
  return (NEIGHBORHOODS as readonly string[]).find((n) => toSlug(n) === slug) as Neighborhood ?? null;
}

function isCitywide(item: MeetingCardData['agenda_items'][number]): boolean {
  return item.district === null && item.neighborhoods.length === 0;
}

function matchesNeighborhood(m: MeetingCardData, n: Neighborhood, includeCitywide: boolean): boolean {
  return m.agenda_items.some((i) => i.neighborhoods.includes(n) || (includeCitywide && isCitywide(i)));
}

export function generateStaticParams() {
  return NEIGHBORHOODS.map((n) => ({ slug: toSlug(n) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const n = fromSlug(slug);
  if (!n) return {};
  return {
    title: `${n} — SF Civic Tracker`,
    description: `SF civic meetings with agenda items affecting ${n}.`,
  };
}

export default async function NeighborhoodPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const neighborhood = fromSlug(slug);
  if (!neighborhood) notFound();

  const includeCitywide = sp['citywide'] === 'show';

  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const [upcomingRes, pastRes] = await Promise.all([
    supabase
      .from('meetings')
      .select(SELECT)
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .limit(200),
    supabase
      .from('meetings')
      .select(SELECT)
      .lt('meeting_date', today)
      .order('meeting_date', { ascending: false })
      .limit(100),
  ]);

  const upcoming = ((upcomingRes.data ?? []) as MeetingCardData[]).filter((m) =>
    matchesNeighborhood(m, neighborhood, includeCitywide),
  );
  const past = ((pastRes.data ?? []) as MeetingCardData[]).filter((m) =>
    matchesNeighborhood(m, neighborhood, includeCitywide),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <a href="/neighborhoods" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All neighborhoods
      </a>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{neighborhood}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Civic meetings with agenda items affecting {neighborhood}.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Show:</span>
          <a
            href={`/neighborhoods/${slug}`}
            className={`rounded-md px-3 py-1 ${!includeCitywide ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}
          >
            {neighborhood}-specific only
          </a>
          <a
            href={`/neighborhoods/${slug}?citywide=show`}
            className={`rounded-md px-3 py-1 ${includeCitywide ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}
          >
            All items (incl. citywide)
          </a>
        </div>
        <a
          href={`/?neighborhood=${encodeURIComponent(neighborhood)}`}
          className="w-fit text-sm text-zinc-500 underline"
        >
          Filter homepage by {neighborhood} →
        </a>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Upcoming</h2>
          <span className="text-xs text-zinc-500">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500">No upcoming meetings with items in {neighborhood}.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} filterItems={(i) => i.neighborhoods.includes(neighborhood) || (includeCitywide && isCitywide(i))} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Past meetings</h2>
          <span className="text-xs text-zinc-500">{past.length}</span>
        </div>
        {past.length === 0 ? (
          <p className="text-sm text-zinc-500">No past meetings with items in {neighborhood}.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {past.map((m) => (
              <MeetingCard key={m.id} meeting={m} filterItems={(i) => i.neighborhoods.includes(neighborhood) || (includeCitywide && isCitywide(i))} />
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Unofficial. Summaries are AI-generated. For canonical agendas see{' '}
        <a
          className="underline"
          href="https://sfplanning.org/hearings-commission"
          target="_blank"
          rel="noopener noreferrer"
        >
          sfplanning.org
        </a>{' '}
        and{' '}
        <a
          className="underline"
          href="https://sfbos.org/meetings"
          target="_blank"
          rel="noopener noreferrer"
        >
          sfbos.org
        </a>
        .
      </footer>
    </main>
  );
}
