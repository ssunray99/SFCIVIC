// Shared display primitives for the editorial visual system.
// All server components — no `'use client'`. Match the prototype in
// design_handoff_sfcivic/primitives.jsx.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SOURCES } from '@/lib/constants';

/* -------------------------------------------------------------------------- */
/*  Eyebrow — small mono uppercase label                                       */
/* -------------------------------------------------------------------------- */

export function Eyebrow({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono uppercase text-[11px] tracking-[0.18em] text-[var(--ink-3)] ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  SectionRule — heavy ink underline + serif heading + optional count/action  */
/* -------------------------------------------------------------------------- */

export function SectionRule({
  label,
  count,
  action,
}: {
  label: string;
  count?: number | string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between border-b border-[var(--ink)] pb-2 mb-4">
      <h2
        className="font-serif font-medium tracking-tight text-[var(--ink)]"
        style={{ fontSize: 32, lineHeight: 1 }}
      >
        {label}
      </h2>
      <div className="flex items-baseline gap-3">
        {count !== undefined && (
          <span className="font-mono text-[12px] text-[var(--accent)] tabular-nums">
            {count}
          </span>
        )}
        {action}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pill — outlined rounded pill (active / accent variants)                    */
/* -------------------------------------------------------------------------- */

type PillProps = {
  children: ReactNode;
  active?: boolean;
  accent?: boolean;
  href?: string;
  className?: string;
};

export function Pill({ children, active, accent, href, className = '' }: PillProps) {
  const base = 'inline-flex items-center rounded-full border px-4 py-2 text-[14.5px] transition-colors';
  const variant = active
    ? 'bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)]'
    : accent
    ? 'bg-transparent text-[var(--accent)] border-[var(--accent)] hover:bg-[var(--accent-soft)]'
    : 'bg-[var(--paper)] text-[var(--ink-2)] border-[var(--rule)] hover:bg-[var(--paper-2)]';
  const cls = `${base} ${variant} ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return <span className={cls}>{children}</span>;
}

/* -------------------------------------------------------------------------- */
/*  Color-coded chips — topic / district / neighborhood                        */
/* -------------------------------------------------------------------------- */

const chipBase =
  'inline-flex items-center px-3 py-1 rounded-full text-[12.5px] whitespace-nowrap';

export function TopicTag({ topic }: { topic: string }) {
  // green
  return (
    <span
      className={chipBase}
      style={{
        background: 'oklch(0.92 0.07 150)',
        color: 'oklch(0.38 0.10 150)',
      }}
    >
      {topic.replace(/-/g, ' ')}
    </span>
  );
}

export function DistrictChip({ district }: { district: number }) {
  // amber
  return (
    <span
      className={chipBase}
      style={{
        background: 'oklch(0.94 0.07 85)',
        color: 'oklch(0.42 0.11 70)',
      }}
    >
      District {district}
    </span>
  );
}

export function NeighborhoodChip({ name }: { name: string }) {
  // blue
  return (
    <span
      className={chipBase}
      style={{
        background: 'oklch(0.93 0.05 240)',
        color: 'oklch(0.40 0.10 240)',
      }}
    >
      {name}
    </span>
  );
}

export function CitywideChip() {
  return (
    <span
      className={`${chipBase} border border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-2)]`}
    >
      Citywide
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  SourcePill — dark filled pill with full source name                        */
/* -------------------------------------------------------------------------- */

const sourceName = (id: string) => SOURCES.find((s) => s.id === id)?.name ?? id;

export function SourcePill({ sourceId }: { sourceId: string }) {
  return (
    <span className="inline-flex items-center px-3.5 py-1 text-[13px] font-medium rounded-full bg-[var(--ink)] text-[var(--paper)]">
      {sourceName(sourceId)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  TypeBadge — outlined item-type pill                                        */
/* -------------------------------------------------------------------------- */

export function TypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  return (
    <span className="inline-flex items-center px-3.5 py-1 text-[13px] rounded-full border border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-2)] capitalize whitespace-nowrap">
      {type}
    </span>
  );
}
