'use client';

// Geocode-by-address form. Calls /api/locate, then routes to /meetings with
// resolved neighborhood/district URL params. Inline error if geocode fails.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type LocateResult = {
  neighborhood: string | null;
  district: number | null;
};

export function AddressSearch() {
  const router = useRouter();
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
        setError("Couldn't find that address — try a neighborhood name");
        return;
      }
      if (!resp.ok) {
        setError('Geocoding failed — try again');
        return;
      }
      const { neighborhood, district } = (await resp.json()) as LocateResult;

      if (!neighborhood && district == null) {
        setError('Address found but outside SF neighborhood/district boundaries');
        return;
      }
      const next = new URLSearchParams();
      if (neighborhood) next.set('neighborhood', neighborhood);
      if (district != null) next.set('district', String(district));
      next.set('addressMode', 'true');
      next.set('view', 'all');

      router.push(`/meetings?${next.toString()}`);
    } catch {
      setError('Geocoding failed — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="Enter an SF address…"
          className="flex-1 border border-[var(--rule)] bg-[var(--paper)] rounded-[6px] px-3 py-2 text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-3)] outline-none focus:border-[var(--ink)]"
          aria-label="Search by address"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="px-4 py-2 font-mono uppercase text-[11px] tracking-[0.16em] bg-[var(--ink)] text-[var(--paper)] rounded-[6px] disabled:opacity-60"
        >
          {loading ? 'Locating…' : 'Locate →'}
        </button>
      </div>
      {error && <p className="text-[12px] text-[var(--accent)]">{error}</p>}
    </form>
  );
}
