import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { SOURCES } from '@/lib/constants';
import { Badge } from '@/components/Badge';

export const revalidate = 300;

// Local types for tables added in migration 0004.
// database.types.ts will be regenerated after `npm run db:push && npm run db:types`.
type Legislation = {
  matter_file_number: string;
  title: string | null;
  matter_type: string | null;
  status: string | null;
  current_body: string | null;
  sponsor: string | null;
  intro_date: string | null;
  final_action_date: string | null;
  url: string | null;
  enriched_at: string | null;
};

type LegislationHistory = {
  id: string;
  matter_file_number: string;
  action_date: string | null;
  action: string | null;
  body: string | null;
  result: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase: ReturnType<typeof createServerClient>) => supabase as any;

const formatDate = (iso: string | null) => {
  if (!iso) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const sourceName = (id: string) => SOURCES.find((s) => s.id === id)?.name ?? id;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fileNumber: string }>;
}) {
  const { fileNumber } = await params;
  const supabase = createServerClient();
  const { data } = await db(supabase)
    .from('legislation')
    .select('title')
    .eq('matter_file_number', fileNumber)
    .maybeSingle() as { data: Pick<Legislation, 'title'> | null };

  const label = data?.title ?? `File #${fileNumber}`;
  return {
    title: `${label} — SF Civic Tracker`,
    description: `Cross-committee tracking for SF matter file number ${fileNumber}.`,
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ fileNumber: string }>;
}) {
  const { fileNumber } = await params;
  const supabase = createServerClient();

  const [legislationRes, historyRes, appearancesRes] = await Promise.all([
    db(supabase)
      .from('legislation')
      .select('*')
      .eq('matter_file_number', fileNumber)
      .maybeSingle() as Promise<{ data: Legislation | null }>,
    db(supabase)
      .from('legislation_history')
      .select('*')
      .eq('matter_file_number', fileNumber)
      .order('action_date', { ascending: false }) as Promise<{ data: LegislationHistory[] | null }>,
    supabase
      .from('agenda_items')
      .select(`
        id,
        title,
        summary,
        item_type,
        meeting_id,
        meetings (
          id,
          source_id,
          title,
          meeting_date,
          agenda_url
        )
      `)
      .eq('matter_file_number', fileNumber)
      .order('id'),
  ]);

  // If neither legislation metadata nor any appearances exist, 404.
  const legislation = legislationRes.data;
  const history = historyRes.data ?? [];
  const appearances = (appearancesRes.data ?? []) as Array<{
    id: string;
    title: string;
    summary: string | null;
    item_type: string | null;
    meeting_id: string;
    meetings: {
      id: string;
      source_id: string;
      title: string;
      meeting_date: string;
      agenda_url: string | null;
    } | null;
  }>;

  if (!legislation && appearances.length === 0) notFound();

  const displayTitle = legislation?.title ?? appearances[0]?.title ?? `File #${fileNumber}`;

  // Sort appearances by meeting date descending.
  const sortedAppearances = [...appearances].sort((a, b) => {
    const da = a.meetings?.meeting_date ?? '';
    const db = b.meetings?.meeting_date ?? '';
    return db.localeCompare(da);
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All meetings
      </a>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">File #{fileNumber}</Badge>
          {legislation?.matter_type && (
            <Badge variant="muted">{legislation.matter_type}</Badge>
          )}
          {legislation?.status && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {legislation.status}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold leading-snug">{displayTitle}</h1>
        {legislation?.sponsor && (
          <p className="text-sm text-zinc-500">Sponsor: {legislation.sponsor}</p>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
          {legislation?.intro_date && (
            <span>Introduced {formatDate(legislation.intro_date)}</span>
          )}
          {legislation?.final_action_date && (
            <span>Final action {formatDate(legislation.final_action_date)}</span>
          )}
          {legislation?.current_body && (
            <span>Currently at {legislation.current_body}</span>
          )}
        </div>
        {legislation?.url && (
          <a
            href={legislation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-xs text-sky-700 underline hover:no-underline dark:text-sky-400"
          >
            View on Legistar ↗
          </a>
        )}
        {!legislation && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Legistar metadata not yet enriched for this matter. Run{' '}
            <code>npm run enrich:legislation</code> to populate.
          </p>
        )}
      </header>

      {sortedAppearances.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">
            Committee appearances ({sortedAppearances.length})
          </h2>
          <div className="flex flex-col gap-3">
            {sortedAppearances.map((item) => {
              const meeting = item.meetings;
              return (
                <div
                  key={item.id}
                  className="rounded-md border border-zinc-200 p-4 dark:border-zinc-700"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    {meeting && (
                      <>
                        <Badge variant="source">{sourceName(meeting.source_id)}</Badge>
                        <time>
                          {formatDate(meeting.meeting_date)}
                        </time>
                      </>
                    )}
                    {item.item_type && <Badge variant="muted">{item.item_type}</Badge>}
                  </div>
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.summary && (
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {item.summary}
                    </p>
                  )}
                  {meeting && (
                    <a
                      href={`/meetings/${meeting.id}`}
                      className="mt-2 block text-xs text-sky-700 underline dark:text-sky-400"
                    >
                      View full meeting →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Legislative history</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-medium text-zinc-500">Date</th>
                  <th className="pb-2 pr-4 font-medium text-zinc-500">Action</th>
                  <th className="pb-2 pr-4 font-medium text-zinc-500">Body</th>
                  <th className="pb-2 font-medium text-zinc-500">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 pr-4 text-zinc-500">{formatDate(h.action_date)}</td>
                    <td className="py-2 pr-4">{h.action ?? '—'}</td>
                    <td className="py-2 pr-4 text-zinc-500">{h.body ?? '—'}</td>
                    <td className="py-2 text-zinc-500">{h.result ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Unofficial. Committee appearances are from AI-extracted agenda summaries and may be
        incomplete. Legislative history is from sfgov.legistar.com.
      </footer>
    </main>
  );
}
