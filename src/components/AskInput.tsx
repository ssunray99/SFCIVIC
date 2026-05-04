'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-800 shadow-sm ' +
  'placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500';

const buttonClass =
  'shrink-0 rounded-md bg-sky-600 px-4 py-3 text-sm font-medium text-white shadow-sm ' +
  'hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
  'disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400';

export function AskInput({
  initial = '',
  autoFocus = false,
  size = 'md',
}: {
  initial?: string;
  autoFocus?: boolean;
  size?: 'md' | 'lg';
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    setSubmitting(true);
    router.push(`/ask?q=${encodeURIComponent(q)}`);
  }

  const sized =
    size === 'lg'
      ? 'px-5 py-4 text-lg'
      : '';

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask anything about SF civic activity…"
        className={`${inputClass} ${sized}`}
        aria-label="Ask"
        autoFocus={autoFocus}
      />
      <button
        type="submit"
        className={`${buttonClass} ${size === 'lg' ? 'px-5 py-4 text-base' : ''}`}
        disabled={submitting || !value.trim()}
      >
        {submitting ? 'Asking…' : 'Ask'}
      </button>
    </form>
  );
}
