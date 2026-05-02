import { Suspense } from 'react';
import { createServerClient } from '@/lib/supabase/server';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';
import { FilterBar } from '@/components/FilterBar';
import {
  NEIGHBORHOODS,
  TOPICS,
  DISTRICTS,
  SOURCES,
  type Neighborhood,
  type Topic,
  type District,
  type SourceId,
} from '@/lib/constants';

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
    topics
  )
`;

type Filters = {
  neighborhood: Neighborhood | undefined;
  topic: Topic | undefined;
  district: District | undefined;
  source: SourceId | undefined;
  q: string | undefined;
};

function parseFilters(raw: Record<string, string | string[] | undefined>): Filters {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);

  const neighborhood = str('neighborhood');
  const topic = str('topic');
  const districtRaw = str('district');
  const source = str('source');
  const districtNum = districtRaw !== undefined ? Number(districtRaw) : NaN;

  return {
    neighborhood: (NEIGHBORHOODS as readonly string[]).includes(neighborhood ?? '')
      ? (neighborhood as Neighborhood)
      : undefined,
    topic: (TOPICS as readonly string[]).includes(topic ?? '') ? (topic as Topic) : undefined,
    district: DISTRICTS.includes(districtNum as District) ? (districtNum as District) : undefined,
    source: SOURCES.some((s) => s.id === source) ? (source as SourceId) : undefined,
    q: str('q')?.trim() || undefined,
  };
}

function applyItemFilters(meetings: MeetingCardData[], filters: Filters): MeetingCardData[] {
  const { neighborhood, topic, district } = filters;
  if (!neighborhood && !topic && district === undefined) return meetings;

  return meetings.filter((m) => {
    const items = m.agenda_items;
    if (neighborhood && !items.some((i) => i.neighborhoods.includes(neighborhood))) return false;
    if (topic && !items.some((i) => i.topics.includes(topic))) return false;
    if (district !== undefined && !items.some((i) => i.district === district)) return false;
    return true;
  });
}

const hasFilters = (f: Filters) =>
  f.neighborhood !== undefined ||
  f.topic !== undefined ||
  f.district !== undefined ||
  f.source !== undefined ||
  f.q !== undefined;

async function getMeetings(filters: Filters): Promise<{
  upcoming: MeetingCardData[];
  past: MeetingCardData[];
}> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const filtered = hasFilters(filters);

  // Text search: query agenda_items FTS index to get matching meeting IDs,
  // then constrain the meetings queries to only those IDs.
  let searchIds: string[] | null = null;
  if (filters.q) {
    const { data: hits, error: ftsErr } = await supabase
      .from('agenda_items')
      .select('meeting_id')
      .textSearch('search_tsv', filters.q, { type: 'websearch', config: 'english' });
    if (ftsErr) console.error('[page] FTS query failed:', ftsErr.message);
    const ids = [...new Set((hits ?? []).map((h) => h.meeting_id as string))];
    if (ids.length === 0) return { upcoming: [], past: [] };
    searchIds = ids;
  }

  const base = () => {
    let q = supabase.from('meetings').select(SELECT);
    if (filters.source) q = q.eq('source_id', filters.source);
    if (searchIds) q = q.in('id', searchIds);
    return q;
  };

  const [upcoming, past] = await Promise.all([
    base()
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .limit(filtered ? 200 : 50),
    base()
      .lt('meeting_date', today)
      .order('meeting_date', { ascending: false })
      .limit(filtered ? 200 : 25),
  ]);

  if (upcoming.error) console.error('[page] upcoming query failed:', upcoming.error.message);
  if (past.error) console.error('[page] past query failed:', past.error.message);

  return {
    upcoming: applyItemFilters((upcoming.data ?? []) as MeetingCardData[], filters),
    past: applyItemFilters((past.data ?? []) as MeetingCardData[], filters),
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const { upcoming, past } = await getMeetings(filters);
  const total = upcoming.length + past.length;
  const isFiltered = hasFilters(filters);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">SF Civic Tracker</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Plain-English summaries of San Francisco Planning Commission agendas, Board of
          Supervisors meetings, and public hearing notices. Filter by neighborhood,
          district, or topic.
        </p>
      </header>

      <Suspense>
        <FilterBar />
      </Suspense>

      {total === 0 && !isFiltered ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No meetings stored yet. Run <code>npm run scrape</code> to populate the database.
        </p>
      ) : total === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No meetings match the current filters.{' '}
          <a href="/" className="underline">
            Clear filters
          </a>{' '}
          to see all meetings.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-medium">Upcoming meetings</h2>
              <span className="text-xs text-zinc-500">{upcoming.length}</span>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-zinc-500">No upcoming meetings match the current filters.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {upcoming.map((m) => (
                  <MeetingCard key={m.id} meeting={m} />
                ))}
              </div>
            )}
          </section>

          {(past.length > 0 || isFiltered) && (
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium">Past meetings</h2>
                <span className="text-xs text-zinc-500">{past.length}</span>
              </div>
              {past.length === 0 ? (
                <p className="text-sm text-zinc-500">No past meetings match the current filters.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {past.map((m) => (
                    <MeetingCard key={m.id} meeting={m} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span>
            Unofficial. Summaries are AI-generated and may be wrong or incomplete. For
            canonical agendas see{' '}
            <a className="underline" href="https://sfplanning.org/hearings-commission" target="_blank" rel="noopener noreferrer">sfplanning.org</a>{' '}
            and{' '}
            <a className="underline" href="https://sfbos.org/meetings" target="_blank" rel="noopener noreferrer">sfbos.org</a>.
          </span>
          <a href="/about" className="ml-4 shrink-0 underline">About</a>
        </div>
      </footer>
    </main>
  );
}
