import { SOURCES } from '@/lib/constants';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">SF Civic Tracker</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Plain-English summaries of San Francisco Planning Commission agendas, Board of
          Supervisors meetings, and public hearing notices. Filter by neighborhood, district,
          or topic.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Sources</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {SOURCES.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="font-medium">{s.name}</span>
              <code className="text-xs text-zinc-500">{s.id}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <p className="font-medium">Milestone 1 placeholder.</p>
        <p className="mt-1">
          Schema, scraper, and filter UI land in M2&ndash;M6. See <code>README.md</code>.
        </p>
      </section>
    </main>
  );
}
