// Single meeting detail page — full agenda for one meeting in the editorial
// style. Reuses the same primitives, ItemSubCard, and ActionCallout-on-one
// rule as the MeetingCard list view.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { ItemSubCard, type ItemSubCardData } from '@/components/ItemSubCard';
import { SourcePill } from '@/components/primitives';
import { fmtDateLong, relativeDay } from '@/lib/format';

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

type MeetingDetail = {
  id: string;
  source_id: string;
  title: string;
  meeting_date: string;
  meeting_time: string | null;
  location: string | null;
  agenda_url: string | null;
  needs_ocr: boolean;
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

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = m.meeting_date >= today;
  const rel = relativeDay(m.meeting_date);
  const actionItemId = pickActionItemId(items, upcoming);

  return (
    <main className="mx-auto max-w-7xl px-10 py-10 flex flex-col gap-7">
      <Link
        href="/meetings"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← All meetings
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[var(--ink-2)]">
          <SourcePill sourceId={m.source_id} />
          <time>{fmtDateLong(m.meeting_date)}</time>
          {rel && (
            <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--accent)]">
              {rel}
            </span>
          )}
          {m.needs_ocr && (
            <span className="font-mono uppercase text-[11px] tracking-[0.14em] text-[var(--ink-3)]">
              scanned PDF — not summarized
            </span>
          )}
        </div>
        <h1
          className="font-serif tracking-tight text-[var(--ink)] leading-tight"
          style={{ fontSize: 38, fontWeight: 500 }}
        >
          {m.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--ink-2)]">
          {m.meeting_time && <span>{m.meeting_time}</span>}
          {m.location && <span>{m.location}</span>}
        </div>
        {m.agenda_url && (
          <a
            href={m.agenda_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[var(--accent)] hover:underline w-fit"
          >
            Original agenda ↗
          </a>
        )}
      </header>

      {items.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
            <span className="font-mono uppercase text-[11px] tracking-[0.18em] text-[var(--ink-3)]">
              Agenda items
            </span>
            <span className="font-mono text-[12px] tabular-nums text-[var(--accent)]">
              {items.length}
            </span>
          </div>
          <div className="flex flex-col gap-3.5">
            {items.map((item) => (
              <ItemSubCard
                key={item.id}
                item={item}
                showAction={item.id === actionItemId}
                meetingDate={m.meeting_date}
                meetingTime={m.meeting_time}
                meetingLocation={m.location}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-[6px] border border-dashed border-[var(--rule)] px-4 py-6 text-[14.5px] text-[var(--ink-2)]">
          {m.needs_ocr
            ? 'This agenda was a scanned PDF — text extraction is not yet implemented.'
            : 'No agenda items have been extracted yet. The agenda may not be posted.'}
        </p>
      )}
    </main>
  );
}
