import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { ItemSubCard, type ItemSubCardData } from '@/components/ItemSubCard';
import { Eyebrow, SectionRule, SourcePill } from '@/components/primitives';
import { fmtDateLong } from '@/lib/format';

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

const fmtOrNull = (iso: string | null) => (iso ? fmtDateLong(iso) : null);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fileNumber: string }>;
}) {
  const { fileNumber } = await params;
  const supabase = createServerClient();
  const { data } = (await db(supabase)
    .from('legislation')
    .select('title')
    .eq('matter_file_number', fileNumber)
    .maybeSingle()) as { data: Pick<Legislation, 'title'> | null };

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
      .order('action_date', { ascending: false }) as Promise<{
      data: LegislationHistory[] | null;
    }>,
    supabase
      .from('agenda_items')
      .select(
        `
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
        matter_file_number,
        meeting_id,
        meetings (
          id,
          source_id,
          title,
          meeting_date,
          meeting_time,
          location,
          agenda_url
        )
      `,
      )
      .eq('matter_file_number', fileNumber)
      .order('id'),
  ]);

  const legislation = legislationRes.data;
  const history = historyRes.data ?? [];
  const appearances = (appearancesRes.data ?? []) as Array<
    ItemSubCardData & {
      meeting_id: string;
      meetings: {
        id: string;
        source_id: string;
        title: string;
        meeting_date: string;
        meeting_time: string | null;
        location: string | null;
        agenda_url: string | null;
      } | null;
    }
  >;

  if (!legislation && appearances.length === 0) notFound();

  // "Legislation Details" is Legistar's page-level heading, not the matter title.
  const legislationTitle =
    legislation?.title && legislation.title.toLowerCase() !== 'legislation details'
      ? legislation.title
      : null;
  const displayTitle =
    legislationTitle ?? appearances[0]?.title ?? `File #${fileNumber}`;

  // Sort appearances by meeting date descending.
  const sortedAppearances = [...appearances].sort((a, b) => {
    const da = a.meetings?.meeting_date ?? '';
    const dbDate = b.meetings?.meeting_date ?? '';
    return dbDate.localeCompare(da);
  });

  return (
    <main className="mx-auto max-w-7xl px-10 py-10 flex flex-col gap-7">
      <Link
        href="/meetings"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← All meetings
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-3)]">
            FILE № {fileNumber}
          </span>
          {legislation?.matter_type && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)] border border-[var(--rule)] rounded-full px-2.5 py-0.5">
              {legislation.matter_type}
            </span>
          )}
          {legislation?.status && (
            <span
              className="rounded-full px-3 py-0.5 text-[12.5px]"
              style={{
                background: 'oklch(0.92 0.07 150)',
                color: 'oklch(0.38 0.10 150)',
              }}
            >
              {legislation.status}
            </span>
          )}
        </div>
        <h1
          className="font-serif tracking-tight text-[var(--ink)] leading-tight"
          style={{ fontSize: 38, fontWeight: 500 }}
        >
          {displayTitle}
        </h1>
        {legislation?.sponsor && (
          <p className="text-[14px] text-[var(--ink-2)]">
            Sponsor: <span className="text-[var(--ink)]">{legislation.sponsor}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--ink-2)]">
          {legislation?.intro_date && (
            <span>Introduced {fmtOrNull(legislation.intro_date)}</span>
          )}
          {legislation?.final_action_date && (
            <span>Final action {fmtOrNull(legislation.final_action_date)}</span>
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
            className="text-[13px] text-[var(--accent)] hover:underline w-fit"
          >
            View on Legistar ↗
          </a>
        )}
        {!legislation && (
          <p
            className="rounded-[6px] px-3 py-2 text-[13px]"
            style={{
              background: 'oklch(0.97 0.05 95)',
              border: '1px solid oklch(0.84 0.10 90)',
              color: 'oklch(0.46 0.13 65)',
            }}
          >
            Legistar metadata not yet enriched for this matter. Run{' '}
            <code className="font-mono">npm run enrich:legislation</code> to populate.
          </p>
        )}
      </header>

      {sortedAppearances.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionRule
            label="Committee appearances"
            count={sortedAppearances.length}
          />
          <div className="flex flex-col gap-5">
            {sortedAppearances.map((item) => {
              const meeting = item.meetings;
              return (
                <div key={item.id} className="flex flex-col gap-2.5">
                  {meeting && (
                    <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[var(--ink-2)]">
                      <SourcePill sourceId={meeting.source_id} />
                      <time>{fmtDateLong(meeting.meeting_date)}</time>
                      <Link
                        href={`/meetings/${meeting.id}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        View full meeting →
                      </Link>
                    </div>
                  )}
                  <ItemSubCard
                    item={item}
                    showAction={false}
                    meetingDate={meeting?.meeting_date ?? ''}
                    meetingTime={meeting?.meeting_time}
                    meetingLocation={meeting?.location}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionRule label="Legislative history" />
          <div className="overflow-x-auto rounded-[8px] border border-[var(--rule)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--rule)] text-left bg-[var(--paper-2)]">
                  <th className="px-4 py-2.5 font-medium text-[var(--ink-3)]">
                    <Eyebrow>Date</Eyebrow>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-[var(--ink-3)]">
                    <Eyebrow>Action</Eyebrow>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-[var(--ink-3)]">
                    <Eyebrow>Committee</Eyebrow>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-[var(--ink-3)]">
                    <Eyebrow>Result</Eyebrow>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-[var(--rule)] last:border-b-0">
                    <td className="px-4 py-2.5 text-[var(--ink-2)] whitespace-nowrap">
                      {fmtOrNull(h.action_date)}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--ink)]">{h.action ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--ink-2)]">{h.body ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--ink-2)]">{h.result ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
