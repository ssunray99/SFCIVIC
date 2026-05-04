// Browse all meetings — Upcoming + Past, with structured filters.
// The homepage previously held this; it now lives on its own focused route so
// the home can stay sleek (hero search + explore cards).

import { Suspense } from 'react';
import Link from 'next/link';
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
    topics,
    comment_deadline,
    comment_email,
    comment_portal_url,
    in_person_slot,
    matter_file_number
  )
`;

type Filters = {
  neighborhood: Neighborhood | undefined;
  topic: Topic | undefined;
  district: District | undefined;
  source: SourceId | undefined;
  q: string | undefined;
  from: string | undefined;
  to: string | undefined;
  view: 'upcoming' | 'past' | 'all';
  // When neighborhood or district is set, default to specific items only
  // (matches /neighborhoods/[slug]). `?citywide=show` opts back into citywide
  // items being treated as matching the location filter.
  citywide: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilters(raw: Record<string, string | string[] | undefined>): Filters {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);

  const neighborhood = str('neighborhood');
  const topic = str('topic');
  const districtRaw = str('district');
  const source = str('source');
  const districtNum = districtRaw !== undefined ? Number(districtRaw) : NaN;
  const from = str('from');
  const to = str('to');
  const viewRaw = str('view');
  const view: Filters['view'] =
    viewRaw === 'past' || viewRaw === 'all' ? viewRaw : 'upcoming';

  return {
    neighborhood: (NEIGHBORHOODS as readonly string[]).includes(neighborhood ?? '')
      ? (neighborhood as Neighborhood)
      : undefined,
    topic: (TOPICS as readonly string[]).includes(topic ?? '') ? (topic as Topic) : undefined,
    district: DISTRICTS.includes(districtNum as District) ? (districtNum as District) : undefined,
    source: SOURCES.some((s) => s.id === source) ? (source as SourceId) : undefined,
    q: str('q')?.trim() || undefined,
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
    view,
    citywide: str('citywide') === 'show',
  };
}

function isCitywide(i: MeetingCardData['agenda_items'][number]): boolean {
  return i.district === null && i.neighborhoods.length === 0;
}

function applyItemFilters(meetings: MeetingCardData[], filters: Filters): MeetingCardData[] {
  const { neighborhood, topic, district, citywide } = filters;
  if (!neighborhood && !topic && district === undefined) return meetings;

  return meetings.filter((m) => {
    const items = m.agenda_items;

    // Neighborhood + district describe the same physical location, so they
    // are OR'd together. The LLM typically tags an item with one or the other
    // (rarely both); requiring both would cut nearly all matches — especially
    // for address search which sets both. Citywide items pass only when the
    // user opted in via ?citywide=show.
    if (neighborhood !== undefined || district !== undefined) {
      const placeMatch = items.some((i) => {
        if (neighborhood && i.neighborhoods.includes(neighborhood)) return true;
        if (district !== undefined && i.district === district) return true;
        if (citywide && isCitywide(i)) return true;
        return false;
      });
      if (!placeMatch) return false;
    }

    if (topic && !items.some((i) => i.topics.includes(topic))) return false;
    return true;
  });
}

const hasFilters = (f: Filters) =>
  f.neighborhood !== undefined ||
  f.topic !== undefined ||
  f.district !== undefined ||
  f.source !== undefined ||
  f.q !== undefined ||
  f.from !== undefined ||
  f.to !== undefined;

async function getMeetings(filters: Filters): Promise<{
  upcoming: MeetingCardData[];
  past: MeetingCardData[];
}> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const filtered = hasFilters(filters);

  let searchIds: string[] | null = null;
  if (filters.q) {
    const { data: hits, error: ftsErr } = await supabase
      .from('agenda_items')
      .select('meeting_id')
      .textSearch('search_tsv', filters.q, { type: 'websearch', config: 'english' });
    if (ftsErr) console.error('[meetings] FTS query failed:', ftsErr.message);
    const ids = [...new Set((hits ?? []).map((h) => h.meeting_id as string))];
    if (ids.length === 0) return { upcoming: [], past: [] };
    searchIds = ids;
  }

  const base = () => {
    let q = supabase.from('meetings').select(SELECT);
    if (filters.source) q = q.eq('source_id', filters.source);
    if (filters.from) q = q.gte('meeting_date', filters.from);
    if (filters.to) q = q.lte('meeting_date', filters.to);
    if (searchIds) q = q.in('id', searchIds);
    return q;
  };

  const upcomingFloor = filters.from && filters.from > today ? filters.from : today;
  const wantsUpcoming = filters.view === 'upcoming' || filters.view === 'all';
  const wantsPast = filters.view === 'past' || filters.view === 'all';

  const [upcoming, past] = await Promise.all([
    wantsUpcoming
      ? base()
          .gte('meeting_date', upcomingFloor)
          .order('meeting_date', { ascending: true })
          .limit(filtered ? 200 : 50)
      : Promise.resolve({ data: [] as MeetingCardData[], error: null }),
    wantsPast
      ? base()
          .lt('meeting_date', today)
          .order('meeting_date', { ascending: false })
          .limit(filtered ? 200 : 50)
      : Promise.resolve({ data: [] as MeetingCardData[], error: null }),
  ]);

  if ('error' in upcoming && upcoming.error) console.error('[meetings] upcoming failed:', upcoming.error.message);
  if ('error' in past && past.error) console.error('[meetings] past failed:', past.error.message);

  return {
    upcoming: applyItemFilters((upcoming.data ?? []) as MeetingCardData[], filters),
    past: applyItemFilters((past.data ?? []) as MeetingCardData[], filters),
  };
}

function ViewToggle({ current }: { current: Filters['view'] }) {
  const tab = (key: Filters['view'], label: string) => {
    const active = current === key;
    return (
      <a
        key={key}
        href={`/meetings${key === 'upcoming' ? '' : `?view=${key}`}`}
        className={
          active
            ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
        }
      >
        {label}
      </a>
    );
  };
  return (
    <div className="flex gap-2">
      {tab('upcoming', 'Upcoming')}
      {tab('past', 'Past')}
      {tab('all', 'All')}
    </div>
  );
}

// Mirrors the toggle on /neighborhoods/[slug]: when filtering by a specific
// place, let the user choose between strict matches and "also include
// citywide items" (which affect every district).
function CitywideToggle({
  raw,
  active,
  label,
}: {
  raw: Record<string, string | string[] | undefined>;
  active: boolean;
  label: string;
}) {
  const buildHref = (showCitywide: boolean) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v && k !== 'citywide') next.set(k, v);
    }
    if (showCitywide) next.set('citywide', 'show');
    const qs = next.toString();
    return qs ? `/meetings?${qs}` : '/meetings';
  };
  const btn = (on: boolean, text: string) =>
    `rounded-md px-3 py-1 text-xs ${
      active === on
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-500">Show:</span>
      <a href={buildHref(false)} className={btn(false, '')}>
        {label} only
      </a>
      <a href={buildHref(true)} className={btn(true, '')}>
        Also include citywide
      </a>
    </div>
  );
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const { upcoming, past } = await getMeetings(filters);
  const total = upcoming.length + past.length;
  const isFiltered = hasFilters(filters);

  // Citywide toggle only makes sense when filtering by a specific place.
  // Address search sets both neighborhood and district; show both in the label.
  const placeFilter = (() => {
    const parts: string[] = [];
    if (filters.neighborhood) parts.push(filters.neighborhood);
    if (filters.district !== undefined) parts.push(`District ${filters.district}`);
    return parts.length > 0 ? parts.join(' / ') : null;
  })();

  // When filtering by place, only render items relevant to that place inside
  // each meeting card (matching /neighborhoods/[slug] behavior). Topic filter
  // alone doesn't trigger this — topic-filtered meetings still show full
  // agendas because surrounding context is useful.
  const itemFilter =
    filters.neighborhood !== undefined || filters.district !== undefined
      ? (i: MeetingCardData['agenda_items'][number]) => {
          if (filters.neighborhood && i.neighborhoods.includes(filters.neighborhood)) return true;
          if (filters.district !== undefined && i.district === filters.district) return true;
          if (filters.citywide && isCitywide(i)) return true;
          return false;
        }
      : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Browse San Francisco civic meetings by date, source, neighborhood, district, or topic.
        </p>
        <ViewToggle current={filters.view} />
      </header>

      <Suspense>
        <FilterBar />
      </Suspense>

      {placeFilter && (
        <CitywideToggle raw={raw} active={filters.citywide} label={placeFilter} />
      )}

      {total === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {isFiltered ? (
            <>
              No meetings match the current filters.{' '}
              <Link href="/meetings" className="underline">
                Clear filters
              </Link>
              .
            </>
          ) : (
            'No meetings stored yet.'
          )}
        </p>
      ) : (
        <>
          {(filters.view === 'upcoming' || filters.view === 'all') && (
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium">Upcoming</h2>
                <span className="text-xs text-zinc-500">{upcoming.length}</span>
              </div>
              {upcoming.length === 0 ? (
                <p className="text-sm text-zinc-500">No upcoming meetings match.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {upcoming.map((m) => (
                    <MeetingCard key={m.id} meeting={m} filterItems={itemFilter} />
                  ))}
                </div>
              )}
            </section>
          )}

          {(filters.view === 'past' || filters.view === 'all') && (
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium">Past</h2>
                <span className="text-xs text-zinc-500">{past.length}</span>
              </div>
              {past.length === 0 ? (
                <p className="text-sm text-zinc-500">No past meetings match.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {past.map((m) => (
                    <MeetingCard key={m.id} meeting={m} filterItems={itemFilter} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
