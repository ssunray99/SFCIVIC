import { SOURCES } from '@/lib/constants';

export const metadata = {
  title: 'About — SF Civic Tracker',
  description: 'How SF Civic Tracker works, where the data comes from, and its limitations.',
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Back to meetings
      </a>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">About SF Civic Tracker</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Plain-English summaries of San Francisco civic meetings, updated automatically.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">What it does</h2>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          SF Civic Tracker scrapes published agendas from SF Planning Commission
          hearings and extracts each agenda item using Gemini 2.5 Flash, a fast AI model.
          Each item gets a plain-English summary, a topic label, and the neighborhood
          and supervisor district it affects — so you can quickly find what matters to you
          without reading dense PDFs.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Data sources</h2>
        <ul className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          {SOURCES.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span className="mt-0.5 text-zinc-400">—</span>
              <span>
                <strong>{s.name}</strong>
                {s.id === 'planning' && (
                  <>
                    {' '}via{' '}
                    <a
                      href="https://sfplanning.org/hearings-cpc-grid"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      sfplanning.org
                    </a>
                  </>
                )}
                {s.id === 'bos' && (
                  <>
                    {' '}via{' '}
                    <a
                      href="https://sfbos.org/meetings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      sfbos.org
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">How it works</h2>
        <ol className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="shrink-0 font-medium text-zinc-400">1.</span>
            <span>
              A scraper built with Playwright visits the SF Planning Commission hearing
              grid and downloads each event page and its agenda PDFs.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 font-medium text-zinc-400">2.</span>
            <span>
              The agenda text (and any scanned PDFs) is sent to{' '}
              <a
                href="https://deepmind.google/technologies/gemini/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Google
              </a>
              &rsquo;s Gemini 2.5 Flash model, which extracts each agenda item and writes a
              short summary in plain English.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 font-medium text-zinc-400">3.</span>
            <span>
              Items are stored in a Supabase database and served to this page, which you
              can filter by neighborhood, supervisor district, or topic.
            </span>
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Limitations</h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="shrink-0 text-zinc-400">—</span>
            <span>
              Summaries are AI-generated and may be incomplete, misleading, or wrong.
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
              Scanned PDFs cannot be read automatically. Items from those meetings will
              appear without summaries.
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

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Built as a learning project.
      </footer>
    </main>
  );
}
