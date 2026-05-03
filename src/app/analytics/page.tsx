import { createServerClient } from '@/lib/supabase/server';
import { SOURCES, TOPICS, DISTRICTS } from '@/lib/constants';

export const revalidate = 300;

export const metadata = {
  title: 'Analytics — SF Civic Tracker',
  description: 'Activity stats for SF civic meetings across committees, neighborhoods, topics, and districts.',
};

const formatTopic = (t: string) =>
  t.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const sourceName = (id: string) => SOURCES.find((s) => s.id === id)?.name ?? id;

function BarRow({
  label,
  count,
  max,
  href,
}: {
  label: string;
  count: number;
  max: number;
  href?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 2;
  const content = (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-right text-xs text-zinc-600 dark:text-zinc-400 truncate">
        {label}
      </span>
      <div className="flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800" style={{ height: '14px' }}>
        <div
          className="h-full rounded bg-sky-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs text-zinc-500">{count}</span>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block hover:opacity-80">
        {content}
      </a>
    );
  }
  return content;
}

export default async function AnalyticsPage() {
  const supabase = createServerClient();
  const currentYear = new Date().getFullYear();

  const [runsRes, meetingsRes] = await Promise.all([
    supabase
      .from('scrape_runs')
      .select('source_id, status, started_at, items_found, items_new')
      .order('started_at', { ascending: false })
      .limit(40),
    supabase
      .from('meetings')
      .select('id, source_id')
      .gte('meeting_date', `${currentYear}-01-01`),
  ]);

  const meetings = meetingsRes.data ?? [];
  const meetingIds = meetings.map((m) => m.id);
  const meetingSourceMap = Object.fromEntries(meetings.map((m) => [m.id, m.source_id]));

  // Fetch this year's agenda items (cap at 5000 — well above expected volume).
  const { data: items } = meetingIds.length > 0
    ? await supabase
        .from('agenda_items')
        .select('id, neighborhoods, topics, district, matter_file_number, meeting_id')
        .in('meeting_id', meetingIds)
        .limit(5000)
    : { data: [] };

  const allItems = items ?? [];

  // Aggregate counts.
  const neighborhoodCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const districtCounts = new Map<number, number>();
  const sourceCounts = new Map<string, number>();
  const matterMeetings = new Map<string, Set<string>>();

  for (const item of allItems) {
    const src = meetingSourceMap[item.meeting_id];
    if (src) sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);

    for (const n of item.neighborhoods ?? []) {
      neighborhoodCounts.set(n, (neighborhoodCounts.get(n) ?? 0) + 1);
    }
    for (const t of item.topics ?? []) {
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
    if (item.district) {
      districtCounts.set(item.district, (districtCounts.get(item.district) ?? 0) + 1);
    }
    if (item.matter_file_number) {
      if (!matterMeetings.has(item.matter_file_number)) {
        matterMeetings.set(item.matter_file_number, new Set());
      }
      matterMeetings.get(item.matter_file_number)!.add(item.meeting_id);
    }
  }

  const topNeighborhoods = [...neighborhoodCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxNeighborhood = topNeighborhoods[0]?.[1] ?? 1;

  const allTopics = TOPICS.map((t) => [t, topicCounts.get(t) ?? 0] as [string, number]).sort(
    (a, b) => b[1] - a[1],
  );
  const maxTopic = allTopics[0]?.[1] ?? 1;

  const allDistricts = DISTRICTS.map((d) => [d, districtCounts.get(d) ?? 0] as [number, number]);
  const maxDistrict = Math.max(...allDistricts.map(([, c]) => c), 1);

  // Cross-committee matters: appeared on 2+ meetings.
  const crossCommittee = [...matterMeetings.entries()]
    .filter(([, ms]) => ms.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 10);

  // Scraper health: most recent run per source.
  const runs = runsRes.data ?? [];
  const latestRunPerSource = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestRunPerSource.has(run.source_id)) {
      latestRunPerSource.set(run.source_id, run);
    }
  }

  const formatRunDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-12 px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All meetings
      </a>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Activity stats for SF civic meetings — {currentYear} year to date.
        </p>
      </header>

      {/* Summary */}
      <section className="grid grid-cols-3 gap-4">
        {[
          { label: 'Meetings', value: meetings.length },
          { label: 'Agenda items', value: allItems.length },
          { label: 'Active sources', value: SOURCES.length },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-md border border-zinc-200 p-4 text-center dark:border-zinc-700"
          >
            <p className="text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </section>

      {/* Neighborhoods */}
      {topNeighborhoods.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Top neighborhoods</h2>
          <div className="flex flex-col gap-2">
            {topNeighborhoods.map(([n, c]) => (
              <BarRow
                key={n}
                label={n}
                count={c}
                max={maxNeighborhood}
                href={`/neighborhoods/${n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Topics */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Items by topic</h2>
        <div className="flex flex-col gap-2">
          {allTopics.map(([t, c]) => (
            <BarRow key={t} label={formatTopic(t)} count={c} max={maxTopic} href={`/topics/${t}`} />
          ))}
        </div>
      </section>

      {/* Districts */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Items by supervisor district</h2>
        <div className="flex flex-col gap-2">
          {allDistricts.map(([d, c]) => (
            <BarRow
              key={d}
              label={`District ${d}`}
              count={c}
              max={maxDistrict}
              href={`/?district=${d}`}
            />
          ))}
        </div>
        <p className="text-xs text-zinc-400">
          Excludes citywide items (no specific district assigned).
        </p>
      </section>

      {/* Items per source */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Items by source</h2>
        {(() => {
          const maxSrc = Math.max(...[...sourceCounts.values()], 1);
          return (
            <div className="flex flex-col gap-2">
              {SOURCES.map((s) => (
                <BarRow
                  key={s.id}
                  label={s.name}
                  count={sourceCounts.get(s.id) ?? 0}
                  max={maxSrc}
                  href={`/?source=${s.id}`}
                />
              ))}
            </div>
          );
        })()}
      </section>

      {/* Cross-committee */}
      {crossCommittee.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">
            Cross-committee matters ({crossCommittee.length} matter
            {crossCommittee.length !== 1 ? 's' : ''} on 2+ meetings)
          </h2>
          <div className="flex flex-col gap-2">
            {crossCommittee.map(([fileNum, ms]) => (
              <a
                key={fileNum}
                href={`/projects/${fileNum}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                <span>File #{fileNum}</span>
                <span className="text-xs text-zinc-500">{ms.size} meetings</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Scraper health */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Scraper health</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                <th className="pb-2 pr-4 font-medium text-zinc-500">Source</th>
                <th className="pb-2 pr-4 font-medium text-zinc-500">Last run</th>
                <th className="pb-2 pr-4 font-medium text-zinc-500">Status</th>
                <th className="pb-2 font-medium text-zinc-500">Items (found / new)</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => {
                const run = latestRunPerSource.get(s.id);
                return (
                  <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-4">{s.name}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {formatRunDate(run?.started_at ?? null)}
                    </td>
                    <td className="py-2 pr-4">
                      {run ? (
                        <span
                          className={
                            run.status === 'success'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : run.status === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-500'
                          }
                        >
                          {run.status}
                        </span>
                      ) : (
                        <span className="text-zinc-400">never</span>
                      )}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {run ? `${run.items_found ?? 0} / ${run.items_new ?? 0}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Stats are year-to-date ({currentYear}). Neighborhood and district assignments are
        AI-extracted and may be incomplete.
      </footer>
    </main>
  );
}
