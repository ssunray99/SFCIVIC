'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { NEIGHBORHOODS, TOPICS, DISTRICTS, SOURCES } from '@/lib/constants';

const selectClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 shadow-sm ' +
  'hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

const inputClass =
  'w-48 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 shadow-sm ' +
  'placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder-zinc-500';

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/?${next.toString()}`);
    },
    [params, router],
  );

  const neighborhood = params.get('neighborhood') ?? '';
  const topic = params.get('topic') ?? '';
  const district = params.get('district') ?? '';
  const source = params.get('source') ?? '';
  const q = params.get('q') ?? '';

  // Local draft for the search input so typing doesn't trigger a navigation
  // on every keystroke — only on Enter or when the form is submitted.
  const [draft, setDraft] = useState(q);
  useEffect(() => { setDraft(q); }, [q]);

  const active = (
    [
      q && { key: 'q', label: `"${q}"` },
      neighborhood && { key: 'neighborhood', label: neighborhood },
      topic && { key: 'topic', label: topic },
      district && { key: 'district', label: `District ${district}` },
      source && { key: 'source', label: SOURCES.find((s) => s.id === source)?.name ?? source },
    ] as (false | { key: string; label: string })[]
  ).filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); update('q', draft.trim()); }}
          className="contents"
        >
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search agenda items…"
            className={inputClass}
            aria-label="Search agenda items"
          />
        </form>

        <select
          value={neighborhood}
          onChange={(e) => update('neighborhood', e.target.value)}
          className={selectClass}
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
          className={selectClass}
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
          className={selectClass}
          aria-label="Filter by topic"
        >
          <option value="">All topics</option>
          {TOPICS.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(e) => update('source', e.target.value)}
          className={selectClass}
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
              onClick={() => update(key, '')}
              className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:hover:bg-sky-900/70"
            >
              {label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <a href="/" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
            Clear all
          </a>
        </div>
      )}
    </div>
  );
}
