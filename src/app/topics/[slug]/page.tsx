import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { TOPICS, type Topic } from '@/lib/constants';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';
import { SectionRule } from '@/components/primitives';

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

const humanize = (t: string) =>
  t.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function fromSlug(slug: string): Topic | null {
  return (TOPICS as readonly string[]).includes(slug) ? (slug as Topic) : null;
}

function matchesTopic(m: MeetingCardData, topic: Topic): boolean {
  return m.agenda_items.some((i) => i.topics.includes(topic));
}

export function generateStaticParams() {
  return TOPICS.map((t) => ({ slug: t }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = fromSlug(slug);
  if (!topic) return {};
  return {
    title: `${humanize(topic)} — SF Civic Tracker`,
    description: `SF civic meetings with agenda items about ${humanize(topic).toLowerCase()}.`,
  };
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const topic = fromSlug(slug);
  if (!topic) notFound();

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
    matchesTopic(m, topic),
  );
  const past = ((pastRes.data ?? []) as MeetingCardData[]).filter((m) =>
    matchesTopic(m, topic),
  );

  const label = humanize(topic);

  return (
    <main className="mx-auto max-w-7xl px-10 py-10 flex flex-col gap-7">
      <Link
        href="/topics"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← All topics
      </Link>

      <header className="flex flex-col gap-3">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 48, lineHeight: 1, fontWeight: 500 }}
        >
          {label}
        </h1>
        <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Civic meetings with agenda items about {label.toLowerCase()}.
        </p>
      </header>

      <section className="flex flex-col gap-5">
        <SectionRule label="Upcoming" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <p className="text-[14.5px] text-[var(--ink-3)]">
            No upcoming meetings with {label.toLowerCase()} items.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {upcoming.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                filterItems={(i) => i.topics.includes(topic)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-5">
        <SectionRule label="Past meetings" count={past.length} />
        {past.length === 0 ? (
          <p className="text-[14.5px] text-[var(--ink-3)]">
            No past meetings with {label.toLowerCase()} items.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {past.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                filterItems={(i) => i.topics.includes(topic)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
