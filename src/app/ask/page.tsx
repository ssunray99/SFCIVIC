// LLM-powered conversational search. Reads ?q= from the URL, runs the shared
// parser to extract structured filters, queries Supabase for the most relevant
// agenda items, then asks Haiku 4.5 to write a 2–4 sentence narrative answer
// with [N] citations linking back to the items rendered below.
//
// Server component. Two states: empty (no ?q=) shows hero + try-asking
// examples; result state shows query as heading + answer card + matching items.

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { parseQuery, ParseError, type ParsedQuery } from '@/lib/search/parse-query';
import { synthesizeAnswer, type ItemContext } from '@/lib/search/synthesize';
import { AskInput } from '@/components/AskInput';
import {
  DistrictChip,
  Eyebrow,
  NeighborhoodChip,
  SectionRule,
  SourcePill,
  TopicTag,
} from '@/components/primitives';
import { SOURCES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  "what's happening with housing in the Mission?",
  'budget items this month',
  'transit projects in District 6',
  'anything from the Planning Commission about Treasure Island?',
] as const;

type ItemRow = {
  id: string;
  title: string;
  summary: string | null;
  district: number | null;
  neighborhoods: string[];
  topics: string[];
  matter_file_number: string | null;
  meeting_id: string;
  meetings: {
    id: string;
    source_id: string;
    meeting_date: string;
    title: string;
  };
};

const sourceName = (id: string) => SOURCES.find((s) => s.id === id)?.name ?? id;

async function findRelevantItems(filters: ParsedQuery): Promise<ItemRow[]> {
  const supabase = createServerClient();

  let query = supabase
    .from('agenda_items')
    .select(
      `
      id, title, summary, district, neighborhoods, topics, matter_file_number,
      meeting_id,
      meetings!inner (
        id, source_id, meeting_date, title
      )
    `,
    );

  if (filters.source) query = query.eq('meetings.source_id', filters.source);
  if (filters.dateFrom) query = query.gte('meetings.meeting_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('meetings.meeting_date', filters.dateTo);
  if (filters.topics.length > 0) query = query.overlaps('topics', filters.topics);
  if (filters.neighborhoods.length > 0)
    query = query.overlaps('neighborhoods', filters.neighborhoods);
  if (filters.district != null) query = query.eq('district', filters.district);
  if (filters.keywords) {
    query = query.textSearch('search_tsv', filters.keywords, {
      type: 'websearch',
      config: 'english',
    });
  }

  query = query
    .order('meeting_date', { referencedTable: 'meetings', ascending: false })
    .limit(30);

  const { data, error } = await query;
  if (error) {
    console.error('[ask] item query failed:', error.message);
    return [];
  }
  return (data ?? []) as unknown as ItemRow[];
}

function toItemContext(rows: ItemRow[]): ItemContext[] {
  return rows.map((r, i) => ({
    index: i + 1,
    title: r.title,
    summary: r.summary,
    source: sourceName(r.meetings.source_id),
    meetingDate: r.meetings.meeting_date,
    district: r.district,
    neighborhoods: r.neighborhoods ?? [],
    topics: r.topics ?? [],
  }));
}

// Renders a synthesized answer, linking citation markers back to the matching
// item rows. Handles single citations `[3]` and combined ones `[1, 3, 5]` —
// inside a combined block each number becomes its own link, with the brackets
// and separators rendered as plain text.
function renderAnswerWithCitations(text: string, itemCount: number) {
  const linkClass =
    'font-mono text-[12px] text-[var(--accent)] hover:underline align-baseline';

  const renderNumber = (n: number, key: string) => {
    if (n >= 1 && n <= itemCount) {
      return (
        <a key={key} href={`#item-${n}`} className={linkClass}>
          {n}
        </a>
      );
    }
    return <span key={key}>{n}</span>;
  };

  const parts = text.split(/(\[[\d,\s-]+\])/g);
  return parts.map((part, i) => {
    const inner = part.match(/^\[([\d,\s-]+)\]$/);
    if (!inner) return <span key={i}>{part}</span>;

    // Single-number citation: keep brackets attached to the link for the
    // familiar `[3]` look.
    const single = inner[1].match(/^\s*(\d+)\s*$/);
    if (single) {
      const n = Number(single[1]);
      if (n >= 1 && n <= itemCount) {
        return (
          <a key={i} href={`#item-${n}`} className={linkClass}>
            [{n}]
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    }

    // Combined citation: split inner on digits and link each number.
    const tokens = inner[1].split(/(\d+)/);
    return (
      <span key={i}>
        [
        {tokens.map((tok, j) => {
          if (/^\d+$/.test(tok)) return renderNumber(Number(tok), `${i}-${j}`);
          return <span key={`${i}-${j}`}>{tok}</span>;
        })}
        ]
      </span>
    );
  });
}

function EmptyState() {
  return (
    <main className="mx-auto max-w-7xl px-10 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 44, lineHeight: 1, fontWeight: 500 }}
        >
          Ask
        </h1>
        <p className="text-[16px] leading-relaxed text-[var(--ink-2)] max-w-2xl">
          Ask about anything happening across the SF civic process — by topic,
          neighborhood, district, or source.
        </p>
      </div>
      <AskInput initial="" autoFocus size="md" />
      <div className="flex flex-col gap-3">
        <Eyebrow>Try asking</Eyebrow>
        <ul className="flex flex-col gap-2">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <Link
                href={`/ask?q=${encodeURIComponent(q)}`}
                className="font-serif italic text-[var(--ink-2)] hover:text-[var(--ink)]"
                style={{ fontSize: 17 }}
              >
                &ldquo;{q}&rdquo;
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';

  if (!q) return <EmptyState />;

  // Parse → fetch → synthesize. Each step's failure mode renders inline.
  let parseErr: string | null = null;
  let filters: ParsedQuery | null = null;
  try {
    filters = await parseQuery(q);
  } catch (err) {
    parseErr = err instanceof ParseError ? err.message : 'Search is unavailable right now.';
  }

  const items = filters ? await findRelevantItems(filters) : [];
  const ctx = toItemContext(items);

  let answer = '';
  let synthErr: string | null = null;
  if (filters) {
    try {
      answer = await synthesizeAnswer(q, ctx);
    } catch (err) {
      console.error('[ask] synthesize failed:', err instanceof Error ? err.message : err);
      synthErr = "Couldn't generate a narrative answer. The matching items are below.";
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-10 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 38, lineHeight: 1.1, fontWeight: 500 }}
        >
          &ldquo;{q}&rdquo;
        </h1>
        <AskInput initial={q} size="md" />
      </header>

      {parseErr && (
        <div
          className="rounded-[6px] px-4 py-3 text-[14px]"
          style={{
            background: 'oklch(0.95 0.04 25)',
            border: '1px solid oklch(0.84 0.10 25)',
            color: 'oklch(0.42 0.13 25)',
          }}
        >
          {parseErr}
        </div>
      )}

      {filters && (
        <section className="border-l-2 border-[var(--accent)] pl-6 py-2 flex flex-col gap-2">
          <Eyebrow>Answer</Eyebrow>
          {synthErr ? (
            <p className="text-[16px] leading-relaxed text-[var(--ink-2)]">{synthErr}</p>
          ) : (
            <p
              className="font-serif leading-relaxed text-[var(--ink)]"
              style={{ fontSize: 19 }}
            >
              {renderAnswerWithCitations(answer, ctx.length)}
            </p>
          )}
        </section>
      )}

      {filters && items.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionRule label="Matching items" count={items.length} />
          <ol className="flex flex-col gap-3">
            {items.map((it, idx) => {
              const n = idx + 1;
              return (
                <li
                  key={it.id}
                  id={`item-${n}`}
                  className="grid gap-x-4 p-5 border border-[var(--rule)] rounded-[8px] bg-[var(--paper)]"
                  style={{ gridTemplateColumns: '32px 1fr' }}
                >
                  <span className="font-mono text-[12px] tabular-nums text-[var(--ink-3)] pt-1">
                    [{n}]
                  </span>
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[var(--ink-2)]">
                      <SourcePill sourceId={it.meetings.source_id} />
                      <time>{fmtDate(it.meetings.meeting_date)}</time>
                    </div>
                    <h3
                      className="font-serif font-medium leading-snug text-[var(--ink)]"
                      style={{ fontSize: 19 }}
                    >
                      <Link
                        href={`/meetings/${it.meeting_id}`}
                        className="hover:underline"
                      >
                        {it.title}
                      </Link>
                    </h3>
                    {it.summary && (
                      <p
                        className="leading-relaxed text-[var(--ink-2)]"
                        style={{ fontSize: 15 }}
                      >
                        {it.summary}
                      </p>
                    )}
                    {(it.district != null ||
                      (it.neighborhoods ?? []).length > 0 ||
                      (it.topics ?? []).length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {it.district != null && <DistrictChip district={it.district} />}
                        {(it.neighborhoods ?? []).map((nbh) => (
                          <NeighborhoodChip key={nbh} name={nbh} />
                        ))}
                        {(it.topics ?? []).map((t) => (
                          <TopicTag key={t} topic={t} />
                        ))}
                      </div>
                    )}
                    {it.matter_file_number && (
                      <Link
                        href={`/projects/${it.matter_file_number}`}
                        className="w-fit text-[12.5px] text-[var(--ink-3)] underline hover:text-[var(--ink-2)]"
                      >
                        FILE № {it.matter_file_number} — track legislation →
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {filters && items.length === 0 && !parseErr && (
        <p className="rounded-[6px] border border-dashed border-[var(--rule)] px-4 py-6 text-[14px] text-[var(--ink-2)]">
          No matching items. Try a broader topic, neighborhood, or date range.
        </p>
      )}
    </main>
  );
}
