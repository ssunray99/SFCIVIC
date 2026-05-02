import { Badge } from './Badge';
import { ItemCard, type ItemCardData } from './ItemCard';
import { SOURCES } from '@/lib/constants';

export type MeetingCardData = {
  id: string;
  source_id: string;
  title: string;
  meeting_date: string;
  agenda_url: string | null;
  needs_ocr: boolean;
  agenda_items: ItemCardData[];
};

const sourceName = (id: string) =>
  SOURCES.find((s) => s.id === id)?.name ?? id;

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function MeetingCard({ meeting }: { meeting: MeetingCardData }) {
  const items = [...meeting.agenda_items].sort((a, b) => {
    const ap = a.position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="source">{sourceName(meeting.source_id)}</Badge>
          <time className="text-zinc-500 dark:text-zinc-400">
            {formatDate(meeting.meeting_date)}
          </time>
          {meeting.needs_ocr && (
            <Badge variant="muted">scanned PDF — not summarized</Badge>
          )}
        </div>
        <h2 className="text-base font-semibold leading-snug">
          <a href={`/meetings/${meeting.id}`} className="hover:underline">
            {meeting.title}
          </a>
        </h2>
        {meeting.agenda_url && (
          <a
            href={meeting.agenda_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-700 hover:underline dark:text-sky-400"
          >
            Original agenda ↗
          </a>
        )}
      </header>

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {meeting.needs_ocr
            ? 'Scanned PDF — OCR not yet implemented.'
            : 'No agenda items extracted yet (agenda may not be posted).'}
        </p>
      )}
    </section>
  );
}
