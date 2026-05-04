'use client';

// Filter dropdowns + active-chip row for the meetings page. Keyword search
// lives on the Ask flow (/ask), not here.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { NEIGHBORHOODS, TOPICS, DISTRICTS, SOURCES } from '@/lib/constants';

const selectBase =
  'border border-[var(--rule)] bg-[var(--paper)] rounded-[6px] px-3.5 py-2 font-mono uppercase text-[12px] tracking-[0.08em] text-[var(--ink-2)] outline-none focus:border-[var(--ink)] cursor-pointer';

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const neighborhood = params.get('neighborhood') ?? '';
  const topic = params.get('topic') ?? '';
  const district = params.get('district') ?? '';
  const source = params.get('source') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const dateRangeLabel = (() => {
    if (from && to) return `${from} → ${to}`;
    if (from) return `from ${from}`;
    if (to) return `until ${to}`;
    return null;
  })();

  const clearDateRange = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('from');
    next.delete('to');
    router.replace(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  const active = (
    [
      neighborhood && { key: 'neighborhood', label: neighborhood },
      topic && { key: 'topic', label: topic },
      district && { key: 'district', label: `District ${district}` },
      source && {
        key: 'source',
        label: SOURCES.find((s) => s.id === source)?.name ?? source,
      },
      dateRangeLabel && { key: 'date-range', label: dateRangeLabel },
    ] as (false | { key: string; label: string })[]
  ).filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={neighborhood}
          onChange={(e) => update('neighborhood', e.target.value)}
          className={selectBase}
          aria-label="Filter by neighborhood"
        >
          <option value="">All neighborhoods</option>
          {NEIGHBORHOODS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <select
          value={district}
          onChange={(e) => update('district', e.target.value)}
          className={selectBase}
          aria-label="Filter by district"
        >
          <option value="">All districts</option>
          {DISTRICTS.map((d) => (
            <option key={d} value={String(d)}>
              District {d}
            </option>
          ))}
        </select>

        <select
          value={topic}
          onChange={(e) => update('topic', e.target.value)}
          className={selectBase}
          aria-label="Filter by topic"
        >
          <option value="">All topics</option>
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(e) => update('source', e.target.value)}
          className={selectBase}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => (key === 'date-range' ? clearDateRange() : update(key, ''))}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-medium hover:opacity-80"
              style={{ background: '#DCEBFB', color: '#1F4E79' }}
            >
              <span aria-hidden="true">×</span> {label}
            </button>
          ))}
          <a
            href={pathname}
            className="ml-1 text-[12.5px] text-[var(--ink-3)] underline hover:text-[var(--ink-2)]"
          >
            Clear all
          </a>
        </div>
      )}
    </div>
  );
}
