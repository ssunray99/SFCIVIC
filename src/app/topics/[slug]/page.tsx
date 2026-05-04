import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { TOPICS, type Topic } from '@/lib/constants';
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
    in_person_slot
  )
`;

function formatTopic(t: string) {
  return t
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

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
    title: `${formatTopic(topic)} — SF Civic Tracker`,
    description: `SF civic meetings with agenda items about ${formatTopic(topic).toLowerCase()}.`,
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

  const label = formatTopic(topic);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <a href="/topics" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All topics
      </a>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{label}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Civic meetings with agenda items about {label.toLowerCase()}.
        </p>
        <a
          href={`/?topic=${encodeURIComponent(topic)}`}
          className="w-fit text-sm text-zinc-500 underline"
        >
          Filter homepage by {label} →
        </a>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Upcoming</h2>
          <span className="text-xs text-zinc-500">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500">No upcoming meetings with {label.toLowerCase()} items.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} filterItems={(i) => i.topics.includes(topic)} />
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
          <p className="text-sm text-zinc-500">No past meetings with {label.toLowerCase()} items.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {past.map((m) => (
              <MeetingCard key={m.id} meeting={m} filterItems={(i) => i.topics.includes(topic)} />
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
