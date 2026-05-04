import { TOPICS } from '@/lib/constants';

export const metadata = {
  title: 'Browse by Topic — SF Civic Tracker',
  description: 'Find SF civic meetings about issues that matter to you.',
};

function formatTopic(t: string) {
  return t
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function TopicsIndex() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All meetings
      </a>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Browse by Topic</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Find SF civic meetings about issues that matter to you.
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TOPICS.map((t) => (
          <li key={t}>
            <a
              href={`/topics/${t}`}
              className="block rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {formatTopic(t)}
            </a>
          </li>
        ))}
      </ul>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Also browse{' '}
        <a href="/neighborhoods" className="underline">
          by neighborhood
        </a>
        .
      </footer>
    </main>
  );
}
