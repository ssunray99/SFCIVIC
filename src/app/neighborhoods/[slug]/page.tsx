import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { NEIGHBORHOODS, type Neighborhood } from '@/lib/constants';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';
import { Eyebrow, Pill, SectionRule } from '@/components/primitives';

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

function toSlug(n: string) {
  return n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function fromSlug(slug: string): Neighborhood | null {
  return (
    (NEIGHBORHOODS as readonly string[]).find((n) => toSlug(n) === slug) as Neighborhood ?? null
  );
}

function isCitywide(item: MeetingCardData['agenda_items'][number]): boolean {
  return item.district === null && item.neighborhoods.length === 0;
}

function matchesNeighborhood(
  m: MeetingCardData,
  n: Neighborhood,
  includeCitywide: boolean,
): boolean {
  return m.agenda_items.some(
    (i) => i.neighborhoods.includes(n) || (includeCitywide && isCitywide(i)),
  );
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
    <main className="mx-auto max-w-7xl px-10 py-10 flex flex-col gap-7">
      <Link
        href="/neighborhoods"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← All neighborhoods
      </Link>

      <header className="flex flex-col gap-3">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 48, lineHeight: 1, fontWeight: 500 }}
        >
          {neighborhood}
        </h1>
        <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Civic meetings with agenda items affecting {neighborhood}.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Eyebrow>Show</Eyebrow>
          <Pill href={`/neighborhoods/${slug}`} active={!includeCitywide}>
            {neighborhood}-specific only
          </Pill>
          <Pill href={`/neighborhoods/${slug}?citywide=show`} active={includeCitywide}>
            All items (incl. citywide)
          </Pill>
        </div>
      </header>

      <section className="flex flex-col gap-5">
        <SectionRule label="Upcoming" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <p className="text-[14.5px] text-[var(--ink-3)]">
            No upcoming meetings with items in {neighborhood}.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {upcoming.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                filterItems={(i) =>
                  i.neighborhoods.includes(neighborhood) || (includeCitywide && isCitywide(i))
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-5">
        <SectionRule label="Past meetings" count={past.length} />
        {past.length === 0 ? (
          <p className="text-[14.5px] text-[var(--ink-3)]">
            No past meetings with items in {neighborhood}.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {past.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                filterItems={(i) =>
                  i.neighborhoods.includes(neighborhood) || (includeCitywide && isCitywide(i))
                }
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
