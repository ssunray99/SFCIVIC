import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { ItemCard, type ItemCardData } from '@/components/ItemCard';
import { Badge } from '@/components/Badge';
import { SOURCES } from '@/lib/constants';

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

type MeetingDetail = {
  id: string;
  source_id: string;
  title: string;
  meeting_date: string;
  agenda_url: string | null;
  needs_ocr: boolean;
  agenda_items: ItemCardData[];
};

const sourceName = (id: string) => SOURCES.find((s) => s.id === id)?.name ?? id;

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data } = await supabase
    .from('meetings')
    .select('title, meeting_date')
    .eq('id', id)
    .maybeSingle();

  if (!data) return { title: 'Meeting not found — SF Civic Tracker' };
  return { title: `${data.title} — SF Civic Tracker` };
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: meeting } = await supabase
    .from('meetings')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();

  if (!meeting) notFound();

  const m = meeting as MeetingDetail;

  const items = [...m.agenda_items].sort((a, b) => {
    const ap = a.position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <a
        href="/"
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        ← All meetings
      </a>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="source">{sourceName(m.source_id)}</Badge>
          <time className="text-zinc-500 dark:text-zinc-400">
            {formatDate(m.meeting_date)}
          </time>
          {m.needs_ocr && (
            <Badge variant="muted">scanned PDF — not summarized</Badge>
          )}
        </div>
        <h1 className="text-2xl font-semibold leading-snug">{m.title}</h1>
        {m.agenda_url && (
          <a
            href={m.agenda_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-700 hover:underline dark:text-sky-400"
          >
            Original agenda ↗
          </a>
        )}
      </header>

      {items.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {items.length} agenda item{items.length !== 1 ? 's' : ''}
          </h2>
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {m.needs_ocr
            ? 'This agenda was a scanned PDF — text extraction is not yet implemented.'
            : 'No agenda items have been extracted yet. The agenda may not be posted.'}
        </p>
      )}

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Unofficial. Summaries are AI-generated and may contain errors.{' '}
        <a href="/about" className="underline">Learn more</a>
      </footer>
    </main>
  );
}
