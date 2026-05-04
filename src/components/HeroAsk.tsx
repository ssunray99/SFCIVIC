'use client';

// Home-page hero: wordmark + tagline + bordered Ask form with rotating
// placeholder + "Try asking" example queries. Submitting routes to
// /ask?q=<value>; clicking an example does the same.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const EXAMPLES = [
  "what's happening with housing in the Mission?",
  'budget items this month',
  'transit projects in District 6',
] as const;

const PLACEHOLDER_INTERVAL_MS = 3200;

function RotatingPlaceholder({ visible }: { visible: boolean }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (!visible) return;
    const tick = setInterval(() => {
      setPhase('out');
      setTimeout(() => {
        setIdx((i) => (i + 1) % EXAMPLES.length);
        setPhase('in');
      }, 280);
    }, PLACEHOLDER_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [visible]);

  if (!visible) return null;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center px-5 font-serif italic text-[var(--ink-3)] transition-all duration-[280ms]"
      style={{
        fontSize: 19,
        opacity: phase === 'in' ? 1 : 0,
        transform: phase === 'in' ? 'translateY(0)' : 'translateY(-8px)',
      }}
    >
      &ldquo;{EXAMPLES[idx]}&rdquo;
    </span>
  );
}

export function HeroAsk() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSubmitting(true);
    router.push(`/ask?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <section className="flex flex-col gap-6">
      <h1
        className="font-serif tracking-tight text-[var(--ink)]"
        style={{ fontSize: 96, lineHeight: 0.95, letterSpacing: '-0.02em', fontWeight: 500 }}
      >
        SF<span className="text-[var(--accent)]">·</span>
        <em>Civic</em>
      </h1>
      <p className="text-[15.5px] leading-relaxed text-[var(--ink-2)] whitespace-nowrap">
        Explore and search across the San Francisco civic process for topics and neighborhoods you care about.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="flex w-full items-stretch border-2 border-[var(--ink)] bg-[var(--paper)]"
      >
        <div className="flex items-center border-r-2 border-[var(--ink)] px-4">
          <span className="font-mono uppercase text-[10.5px] tracking-[0.2em] text-[var(--ink)]">
            Ask
          </span>
        </div>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder=""
            className="w-full bg-transparent px-5 py-4 font-serif text-[var(--ink)] outline-none"
            style={{ fontSize: 19 }}
            aria-label="Ask"
          />
          <RotatingPlaceholder visible={value.length === 0} />
        </div>
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="px-6 font-mono uppercase text-[11px] tracking-[0.18em] bg-[var(--accent)] text-[var(--paper)] disabled:opacity-60"
        >
          Ask&nbsp;&nbsp;→
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-mono uppercase text-[10.5px] tracking-[0.2em] text-[var(--ink-3)]">
          Try asking
        </span>
        {EXAMPLES.map((q) => (
          <Link
            key={q}
            href={`/ask?q=${encodeURIComponent(q)}`}
            className="font-serif italic text-[var(--ink-2)] hover:text-[var(--ink)]"
            style={{ fontSize: 15.5 }}
          >
            &ldquo;{q}&rdquo;
          </Link>
        ))}
      </div>
    </section>
  );
}
