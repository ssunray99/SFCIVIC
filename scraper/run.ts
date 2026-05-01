import { scrape as scrapePlanning } from './sources/planning.ts';
import { closeBrowser } from './lib/playwright.ts';

// Accept an optional source filter as the first CLI arg:
//   tsx scraper/run.ts            → run all sources
//   tsx scraper/run.ts planning   → run only Planning Commission
const filter = process.argv[2]?.toLowerCase();

const sources: Array<{ id: string; fn: () => Promise<void> }> = [
  { id: 'planning', fn: scrapePlanning },
  // bos and hearings added in M4
];

const toRun = filter ? sources.filter((s) => s.id === filter) : sources;

if (toRun.length === 0) {
  console.error(`Unknown source: "${filter}". Available: ${sources.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

async function main() {
  for (const { id, fn } of toRun) {
    console.log(`\n=== scraping: ${id} ===`);
    try {
      await fn();
    } catch (err) {
      // Log and continue — one failing source must not block the others
      console.error(`[${id}] FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  await closeBrowser();
  console.log('\nAll done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
