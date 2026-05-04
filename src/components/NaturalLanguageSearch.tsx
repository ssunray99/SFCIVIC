'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

type ParseResult = {
  topics: string[];
  neighborhoods: string[];
  district: number | null;
  source: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string;
};

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm ' +
  'placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder-zinc-500';

const buttonClass =
  'shrink-0 rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm ' +
  'hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400';

export function NaturalLanguageSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!resp.ok) {
        setError('Search failed — try again');
        return;
      }
      const parsed = (await resp.json()) as ParseResult;

      const anyMatch =
        parsed.topics.length > 0 ||
        parsed.neighborhoods.length > 0 ||
        parsed.district != null ||
        parsed.source != null ||
        parsed.dateFrom != null ||
        parsed.dateTo != null ||
        parsed.keywords.length > 0;

      if (!anyMatch) {
        setError("Couldn't parse that — try a topic, neighborhood, or district");
        return;
      }

      const next = new URLSearchParams(params.toString());
      // Filter UI is single-value today; take the first of any array result.
      if (parsed.topics[0]) next.set('topic', parsed.topics[0]);
      else next.delete('topic');
      if (parsed.neighborhoods[0]) next.set('neighborhood', parsed.neighborhoods[0]);
      else next.delete('neighborhood');
      if (parsed.district != null) next.set('district', String(parsed.district));
      else next.delete('district');
      if (parsed.source) next.set('source', parsed.source);
      else next.delete('source');
      if (parsed.dateFrom) next.set('from', parsed.dateFrom);
      else next.delete('from');
      if (parsed.dateTo) next.set('to', parsed.dateTo);
      else next.delete('to');
      if (parsed.keywords) next.set('q', parsed.keywords);
      else next.delete('q');

      router.replace(`/?${next.toString()}`);
      setValue('');
    } catch {
      setError('Search failed — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          placeholder="Try: housing in District 5 next month"
          className={inputClass}
          aria-label="Natural-language search"
          disabled={loading}
        />
        <button type="submit" className={buttonClass} disabled={loading || !value.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}
