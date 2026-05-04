// LLM-powered conversational search.
//
// Reads ?q= from the URL, runs the shared parser to extract structured filters,
// queries Supabase for the most relevant agenda items, then asks Haiku 4.5 to
// write a 2–4 sentence narrative answer with [N] citations linking back to the
// items rendered below.
//
// Server component, no client data-fetching. Errors surface inline.

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { parseQuery, ParseError, type ParsedQuery } from '@/lib/search/parse-query';
import { synthesizeAnswer, type ItemContext } from '@/lib/search/synthesize';
import { Badge } from '@/components/Badge';
import { AskInput } from '@/components/AskInput';
import { SOURCES } from '@/lib/constants';

export const dynamic = 'force-dynamic';

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

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

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
  if (filters.neighborhoods.length > 0) query = query.overlaps('neighborhoods', filters.neighborhoods);
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

function renderAnswerWithCitations(text: string, itemCount: number) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= itemCount) {
        return (
          <a
            key={i}
            href={`#item-${n}`}
            className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
          >
            [{n}]
          </a>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

function FiltersChips({ filters }: { filters: ParsedQuery }) {
  const chips: { label: string; key: string }[] = [];
  for (const t of filters.topics) chips.push({ key: `t-${t}`, label: t });
  for (const n of filters.neighborhoods) chips.push({ key: `n-${n}`, label: n });
  if (filters.district != null) chips.push({ key: 'd', label: `District ${filters.district}` });
  if (filters.source) chips.push({ key: 's', label: sourceName(filters.source) });
  if (filters.dateFrom || filters.dateTo) {
    chips.push({
      key: 'date',
      label: `${filters.dateFrom ?? '…'} → ${filters.dateTo ?? '…'}`,
    });
  }
  if (filters.keywords) chips.push({ key: 'kw', label: `"${filters.keywords}"` });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">Interpreted as:</span>
      {chips.map((c) => (
        <Badge key={c.key} variant="muted">
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';

  // Empty state — show the input only.
  if (!q) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Ask a question about San Francisco civic activity. Examples: &ldquo;What&rsquo;s
            happening with housing in the Mission?&rdquo; · &ldquo;Show me budget items
            this month&rdquo; · &ldquo;Anything from the Planning Commission about
            Treasure Island?&rdquo;
          </p>
        </header>
        <AskInput initial="" autoFocus />
      </main>
    );
  }

  // Parse → fetch → synthesize. Each step's failure mode renders inline.
  let parseErr: string | null = null;
  let filters: ParsedQuery | null = null;
  try {
    filters = await parseQuery(q);
  } catch (err) {
    parseErr =
      err instanceof ParseError ? err.message : 'Search is unavailable right now.';
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <AskInput initial={q} />
        {filters && <FiltersChips filters={filters} />}
      </header>

      {parseErr && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {parseErr}
        </div>
      )}

      {filters && (
        <section className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50/50 p-5 dark:border-sky-900/60 dark:bg-sky-950/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            Answer
          </h2>
          {synthErr ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{synthErr}</p>
          ) : (
            <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
              {renderAnswerWithCitations(answer, ctx.length)}
            </p>
          )}
        </section>
      )}

      {filters && items.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Matching items</h2>
            <span className="text-xs text-zinc-500">{items.length}</span>
          </div>
          <ol className="flex flex-col gap-3">
            {items.map((it, idx) => {
              const n = idx + 1;
              return (
                <li
                  key={it.id}
                  id={`item-${n}`}
                  className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono text-zinc-400">[{n}]</span>
                    <Badge variant="source">{sourceName(it.meetings.source_id)}</Badge>
                    <time>{formatDate(it.meetings.meeting_date)}</time>
                  </div>
                  <h3 className="text-sm font-medium leading-snug">
                    <Link href={`/meetings/${it.meeting_id}`} className="hover:underline">
                      {it.title}
                    </Link>
                  </h3>
                  {it.summary && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{it.summary}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {it.district != null && (
                      <Badge variant="district">District {it.district}</Badge>
                    )}
                    {(it.neighborhoods ?? []).map((nbh) => (
                      <Badge key={nbh} variant="neighborhood">
                        {nbh}
                      </Badge>
                    ))}
                    {(it.topics ?? []).map((t) => (
                      <Badge key={t} variant="topic">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  {it.matter_file_number && (
                    <Link
                      href={`/projects/${it.matter_file_number}`}
                      className="w-fit text-xs text-sky-700 underline dark:text-sky-400"
                    >
                      File #{it.matter_file_number} — track this legislation →
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {filters && items.length === 0 && !parseErr && (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No matching items. Try a broader topic, neighborhood, or date range.
        </p>
      )}
    </main>
  );
}
