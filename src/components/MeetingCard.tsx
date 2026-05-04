// Outer card for a single meeting. Header (source pill + date + relative-day
// badge + serif title + agenda link) + a stack of ItemSubCards below. The
// ActionCallout shows on at most one item per meeting — the first with
// public-comment fields, falling back to the second item on upcoming meetings
// when no item is flagged.

import { fmtDate, relativeDay } from '@/lib/format';
import { SourcePill } from './primitives';
import { ItemSubCard, type ItemSubCardData } from './ItemSubCard';

export type MeetingCardData = {
  id: string;
  source_id: string;
  title: string;
  meeting_date: string;
  agenda_url: string | null;
  needs_ocr: boolean;
  meeting_time?: string | null;
  location?: string | null;
  agenda_items: ItemSubCardData[];
};

const hasActionFields = (i: ItemSubCardData) =>
  i.comment_deadline != null ||
  i.comment_email != null ||
  i.comment_portal_url != null ||
  i.in_person_slot != null;

function pickActionItemId(items: ItemSubCardData[], upcoming: boolean): string | null {
  const flagged = items.find(hasActionFields);
  if (flagged) return flagged.id;
  if (upcoming && items.length >= 2) return items[1].id;
  return null;
}

export function MeetingCard({
  meeting,
  filterItems,
}: {
  meeting: MeetingCardData;
  filterItems?: (item: ItemSubCardData) => boolean;
}) {
  const items = [
    ...(filterItems ? meeting.agenda_items.filter(filterItems) : meeting.agenda_items),
  ].sort((a, b) => {
    const ap = a.position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.position ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meeting.meeting_date >= today;
  const rel = relativeDay(meeting.meeting_date);
  const actionItemId = pickActionItemId(items, upcoming);

  // Compact one-liner for meetings with no content yet — keeps the list
  // scannable instead of repeating big card headers for empty agendas.
  if (items.length === 0) {
    const cancelled = /\bcancell?ed\b/i.test(meeting.title);
    const placeholder = cancelled
      ? 'Cancelled'
      : meeting.needs_ocr
      ? 'OCR pending'
      : 'Agenda not posted';
    return (
      <a
        href={`/meetings/${meeting.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] border border-[var(--rule)] bg-[var(--paper)] px-4 py-2.5 text-[13px] hover:bg-[var(--paper-2)] transition-colors"
      >
        <SourcePill sourceId={meeting.source_id} />
        <time className="text-[var(--ink-2)]">{fmtDate(meeting.meeting_date)}</time>
        {rel && (
          <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--accent)]">
            {rel}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{meeting.title}</span>
        <span className="font-mono uppercase text-[11px] tracking-[0.14em] text-[var(--ink-3)]">
          {placeholder}
        </span>
      </a>
    );
  }

  return (
    <section className="flex flex-col rounded-[8px] border border-[var(--rule)] bg-[var(--paper)]">
      <header className="px-6 pt-5 pb-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[var(--ink-2)]">
          <SourcePill sourceId={meeting.source_id} />
          <time>{fmtDate(meeting.meeting_date)}</time>
          {rel && (
            <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--accent)]">
              {rel}
            </span>
          )}
        </div>
        <h2
          className="font-serif font-medium leading-tight text-[var(--ink)]"
          style={{ fontSize: 24 }}
        >
          <a href={`/meetings/${meeting.id}`} className="hover:underline">
            {meeting.title}
          </a>
        </h2>
        {meeting.agenda_url && (
          <a
            href={meeting.agenda_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[var(--accent)] hover:underline w-fit"
          >
            Original agenda ↗
          </a>
        )}
      </header>

      <div className="px-6 pb-6 flex flex-col gap-3.5">
        {items.map((item) => (
          <ItemSubCard
            key={item.id}
            item={item}
            showAction={item.id === actionItemId}
            meetingDate={meeting.meeting_date}
            meetingTime={meeting.meeting_time}
            meetingLocation={meeting.location}
          />
        ))}
      </div>
    </section>
  );
}
