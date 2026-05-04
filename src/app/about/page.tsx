import Link from 'next/link';
import { SOURCES } from '@/lib/constants';
import { SectionRule } from '@/components/primitives';

export const metadata = {
  title: 'About — SF Civic Tracker',
  description: 'About SF Civic Tracker, where the data comes from, and its limitations.',
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-4xl px-10 py-12 flex flex-col gap-10">
      <Link
        href="/"
        className="font-mono uppercase text-[11px] tracking-[0.16em] text-[var(--ink-3)] hover:text-[var(--ink-2)] w-fit"
      >
        ← Home
      </Link>

      <header className="flex flex-col gap-3">
        <h1
          className="font-serif tracking-tight text-[var(--ink)]"
          style={{ fontSize: 48, lineHeight: 1, fontWeight: 500 }}
        >
          About SF<span className="text-[var(--accent)]">·</span>
          <em>Civic</em>
        </h1>
      </header>

      <section className="flex flex-col gap-4">
        <SectionRule label="What it does" />
        <p className="font-serif leading-relaxed text-[var(--ink)]" style={{ fontSize: 18 }}>
          SF Civic Tracker turns complex legislative meeting content into something
          you can easily browse and search. It gathers content from civic meetings
          and presents it with a concise summary, clear topic tags, and the
          relevant neighborhood and supervisor district&mdash;so you can quickly
          spot what matters to you, track legislation, and submit public comment
          before deadlines.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionRule label="Civic groups tracked" />
        <ul className="flex flex-col gap-2">
          {SOURCES.map((s) => (
            <li
              key={s.id}
              className="flex items-baseline gap-3 text-[15.5px] text-[var(--ink-2)]"
            >
              <span className="text-[var(--ink-3)]">—</span>
              <span className="text-[var(--ink)]">{s.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionRule label="Limitations" />
        <ul className="flex flex-col gap-3 text-[15.5px] leading-relaxed text-[var(--ink-2)]">
          <li className="flex gap-3">
            <span className="shrink-0 text-[var(--ink-3)]">—</span>
            <span>
              Summaries are auto-generated and may be incomplete, misleading, or
              wrong. Always verify against the{' '}
              <a
                href="https://sfplanning.org/hearings-commission"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--ink)]"
              >
                official agenda
              </a>{' '}
              before acting on anything here.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 text-[var(--ink-3)]">—</span>
            <span>
              Some older meetings posted as scanned PDFs may appear without item
              summaries.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 text-[var(--ink-3)]">—</span>
            <span>
              This is an unofficial project with no affiliation with the City and
              County of San Francisco.
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}
