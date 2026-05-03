'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

type LocateResult = {
  neighborhood: string | null;
  district: number | null;
};

const inputClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 shadow-sm ' +
  'placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder-zinc-500';

const buttonClass =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 shadow-sm ' +
  'hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

export function AddressSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (!address) return;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(`/api/locate?address=${encodeURIComponent(address)}`);
      if (resp.status === 404) {
        setError('Address not found in San Francisco');
        return;
      }
      if (!resp.ok) {
        setError('Geocoding failed — try again');
        return;
      }
      const { neighborhood, district } = (await resp.json()) as LocateResult;

      const next = new URLSearchParams(params.toString());

      if (!neighborhood && district == null) {
        setError('Address found but outside SF neighborhood/district boundaries');
        return;
      }
      if (neighborhood) next.set('neighborhood', neighborhood);
      else next.delete('neighborhood');
      if (district != null) next.set('district', String(district));
      else next.delete('district');

      router.replace(`/?${next.toString()}`);
    } catch {
      setError('Geocoding failed — try again');
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
          placeholder="Enter an SF address…"
          className={`${inputClass} w-56`}
          aria-label="Search by address"
          disabled={loading}
        />
        <button type="submit" className={buttonClass} disabled={loading || !value.trim()}>
          {loading ? 'Locating…' : 'Find nearby'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}
