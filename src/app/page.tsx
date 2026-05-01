import { createServerClient } from '@/lib/supabase/server';
import { MeetingCard, type MeetingCardData } from '@/components/MeetingCard';

export const revalidate = 300; // re-fetch from Supabase at most every 5 minutes

const PAGE_SIZE = 25;

async function getRecentMeetings(): Promise<MeetingCardData[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('meetings')
    .select(
      `
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
      `,
    )
    .order('meeting_date', { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    console.error('[page] meetings query failed:', error.message);
    return [];
  }
  return (data ?? []) as MeetingCardData[];
}

export default async function Home() {
  const meetings = await getRecentMeetings();

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

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Recent meetings</h2>
          <span className="text-xs text-zinc-500">
            {meetings.length} shown
          </span>
        </div>

        {meetings.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No meetings stored yet. Run <code>npm run scrape</code> to populate the database.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {meetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Unofficial. Summaries are AI-generated and may be wrong or incomplete. For
        canonical agendas see{' '}
        <a className="underline" href="https://sfplanning.org/hearings-commission" target="_blank" rel="noopener noreferrer">sfplanning.org</a>{' '}
        and{' '}
        <a className="underline" href="https://sfbos.org/meetings" target="_blank" rel="noopener noreferrer">sfbos.org</a>.
      </footer>
    </main>
  );
}
