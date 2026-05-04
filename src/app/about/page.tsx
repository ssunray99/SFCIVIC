import Link from 'next/link';
import { SOURCES } from '@/lib/constants';

export const metadata = {
  title: 'About — SF Civic Tracker',
  description: 'About SF Civic Tracker, where the data comes from, and its limitations.',
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Back to home
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">About SF Civic Tracker</h1>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">What it does</h2>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          SF Civic Tracker organizes city meetings into something you can easily
          explore and search. It compiles content from civic meetings with a short
          summary, a topic label, and the neighborhood and supervisor district it
          affects — so you can quickly see what&rsquo;s coming up that matters to you,
          follow legislation across committees, and submit comment before the deadline.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Civic Groups Tracked</h2>
        <ul className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          {SOURCES.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span className="mt-0.5 text-zinc-400">—</span>
              <span>
                <strong>{s.name}</strong>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Limitations</h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="shrink-0 text-zinc-400">—</span>
            <span>
              Summaries are auto-generated and may be incomplete, misleading, or wrong.
              Always verify against the{' '}
              <a
                href="https://sfplanning.org/hearings-commission"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                official agenda
              </a>{' '}
              before acting on anything here.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 text-zinc-400">—</span>
            <span>
              Some older meetings posted as scanned PDFs may appear without item
              summaries.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 text-zinc-400">—</span>
            <span>
              This is an unofficial project with no affiliation with the City and County
              of San Francisco.
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}
