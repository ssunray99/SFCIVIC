// Browse all meetings — Upcoming + Past, with structured filters.
// The homepage previously held this; it now lives on its own focused route so
// the home can stay sleek (hero search + explore cards).

import { Suspense } from 'react';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';
import { FilterBar } from '@/components/FilterBar';
import { Eyebrow, Pill, SectionRule } from '@/components/primitives';
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
  meeting_time,
  location,
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
  f.from !== undefined ||
  f.to !== undefined;

async function getMeetings(filters: Filters): Promise<{
  upcoming: MeetingCardData[];
  past: MeetingCardData[];
}> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const filtered = hasFilters(filters);

  const base = () => {
    let q = supabase.from('meetings').select(SELECT);
    if (filters.source) q = q.eq('source_id', filters.source);
    if (filters.from) q = q.gte('meeting_date', filters.from);
    if (filters.to) q = q.lte('meeting_date', filters.to);
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
    const href = `/meetings${key === 'upcoming' ? '' : `?view=${key}`}`;
    const cls = `rounded-[6px] px-4 py-1.5 text-[13.5px] font-medium border transition-colors ${
      active
        ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
        : 'bg-[var(--paper)] text-[var(--ink-2)] border-[var(--rule)] hover:bg-[var(--paper-2)]'
    }`;
    return (
      <a key={key} href={href} className={cls}>
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
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Eyebrow>Show</Eyebrow>
      <Pill href={buildHref(false)} active={!active}>
        {label} only
      </Pill>
      <Pill href={buildHref(true)} active={active}>
        Also include citywide
      </Pill>
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

  // When filtering, render only items relevant to the active filter inside
  // each meeting card. Topic, neighborhood, and district all narrow the
  // visible items so the page reflects what was asked for. When multiple
  // filters are set, an item must match every active filter (AND).
  const hasItemNarrowing =
    filters.topic !== undefined ||
    filters.neighborhood !== undefined ||
    filters.district !== undefined;
  const itemFilter = hasItemNarrowing
    ? (i: MeetingCardData['agenda_items'][number]) => {
        if (filters.topic && !i.topics.includes(filters.topic)) return false;
        if (filters.neighborhood !== undefined || filters.district !== undefined) {
          const placeMatch =
            (filters.neighborhood && i.neighborhoods.includes(filters.neighborhood)) ||
            (filters.district !== undefined && i.district === filters.district) ||
            (filters.citywide && isCitywide(i));
          if (!placeMatch) return false;
        }
        return true;
      }
    : undefined;

  return (
    <main className="mx-auto max-w-7xl px-10 py-10 flex flex-col gap-7">
      <header className="flex flex-col gap-4">
        <Link
          href="/"
          className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
        >
          ← Back
        </Link>
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 48, lineHeight: 1, fontWeight: 500 }}
        >
          Meetings
        </h1>
        <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Browse San Francisco civic meetings by date, source, neighborhood,
          district, or topic.
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
        <p className="rounded-[6px] border border-dashed border-[var(--rule)] px-4 py-6 text-[14.5px] text-[var(--ink-2)]">
          {isFiltered ? (
            <>
              No meetings match the current filters.{' '}
              <Link href="/meetings" className="underline hover:text-[var(--ink)]">
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
            <section className="flex flex-col gap-5">
              <SectionRule label="Upcoming" count={upcoming.length} />
              {upcoming.length === 0 ? (
                <p className="text-[14.5px] text-[var(--ink-3)]">No upcoming meetings match.</p>
              ) : (
                <div className="flex flex-col gap-5">
                  {upcoming.map((m) => (
                    <MeetingCard key={m.id} meeting={m} filterItems={itemFilter} />
                  ))}
                </div>
              )}
            </section>
          )}

          {(filters.view === 'past' || filters.view === 'all') && (
            <section className="flex flex-col gap-5">
              <SectionRule label="Past" count={past.length} />
              {past.length === 0 ? (
                <p className="text-[14.5px] text-[var(--ink-3)]">No past meetings match.</p>
              ) : (
                <div className="flex flex-col gap-5">
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
