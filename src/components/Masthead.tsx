'use client';

// Top-of-page masthead with serif "SF·Civic" wordmark and right-aligned
// nav links. Active route gets a 2px accent underline; inactive routes are
// muted. The "Ask" link goes to /ask without preserving any prior ?q=.
//
// Footer carries the unofficial-site disclaimer + canonical-source links;
// shown on every page via layout.tsx.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: { href: string; label: string; match: (path: string) => boolean }[] = [
  { href: '/', label: 'Home', match: (p) => p === '/' },
  { href: '/topics', label: 'Topics', match: (p) => p.startsWith('/topics') },
  {
    href: '/neighborhoods',
    label: 'Neighborhoods',
    match: (p) => p.startsWith('/neighborhoods'),
  },
  { href: '/meetings', label: 'Meetings', match: (p) => p.startsWith('/meetings') },
  { href: '/ask', label: 'Ask', match: (p) => p.startsWith('/ask') },
  { href: '/about', label: 'About', match: (p) => p.startsWith('/about') },
];

export function Masthead() {
  const pathname = usePathname() || '/';

  return (
    <header className="border-b border-[var(--rule)]">
      <div className="h-1 bg-[var(--ink)]" />
      <div className="px-10 pt-5 pb-4 flex items-end justify-between gap-6">
        <Link href="/" className="font-serif tracking-tight text-[var(--ink)]" style={{ fontSize: 26 }}>
          <span className="font-medium">SF</span>
          <span className="text-[var(--accent)] font-medium">·</span>
          <em className="font-medium">Civic</em>
        </Link>
        <nav className="flex flex-wrap items-end gap-x-6 gap-y-2">
          {NAV.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`font-mono uppercase text-[11.5px] tracking-[0.16em] pb-0.5 border-b-2 transition-colors ${
                  active
                    ? 'text-[var(--ink)] border-[var(--accent)]'
                    : 'text-[var(--ink-3)] border-transparent hover:text-[var(--ink-2)]'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 px-10 pt-6 pb-10 border-t border-[var(--rule)]">
      <div className="flex flex-col gap-2 max-w-3xl">
        <p className="text-[12.5px] leading-relaxed text-[var(--ink-2)]">
          <strong className="font-medium text-[var(--ink)]">
            Unofficial — not an official City of San Francisco website.
          </strong>{' '}
          Summaries are AI-generated and may be incomplete or wrong. Don&rsquo;t
          rely on this site for legal, voting, or compliance decisions. For
          canonical agendas consult{' '}
          <a
            href="https://sfplanning.org/hearings-commission"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--ink)]"
          >
            sfplanning.org
          </a>{' '}
          and{' '}
          <a
            href="https://sfbos.org/meetings"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--ink)]"
          >
            sfbos.org
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
