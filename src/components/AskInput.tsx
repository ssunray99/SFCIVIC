'use client';

// Bordered Ask form used on the /ask page (and re-exported for any future
// inline placement). Mirrors the home HeroAsk form style but smaller and
// without the rotating placeholder. Submitting routes to /ask?q=<value>.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

  const inputSize = size === 'lg' ? 19 : 17;
  const inputPad = size === 'lg' ? 'py-4' : 'py-3.5';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full items-stretch border-2 border-[var(--ink)] bg-[var(--paper)]"
    >
      <div className="flex items-center border-r-2 border-[var(--ink)] px-4">
        <span className="font-mono uppercase text-[11px] tracking-[0.2em] text-[var(--ink)]">
          Ask
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask a question…"
        className={`flex-1 bg-transparent px-5 ${inputPad} font-serif text-[var(--ink)] placeholder:italic placeholder:text-[var(--ink-3)] outline-none`}
        style={{ fontSize: inputSize }}
        aria-label="Ask"
        autoFocus={autoFocus}
      />
      <button
        type="submit"
        disabled={submitting || !value.trim()}
        className="px-6 font-mono uppercase text-[12px] tracking-[0.18em] bg-[var(--accent)] text-[var(--paper)] disabled:opacity-60"
      >
        Ask&nbsp;&nbsp;→
      </button>
    </form>
  );
}
