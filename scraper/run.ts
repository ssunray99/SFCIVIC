import { scrape as scrapePlanning, extractExisting as extractPlanning } from './sources/planning.ts';
import { scrape as scrapeBos } from './sources/bos.ts';
import { scrape as scrapeHearings } from './sources/hearings.ts';
import { closeBrowser } from './lib/playwright.ts';

// CLI usage:
//   tsx scraper/run.ts                → scrape all sources
//   tsx scraper/run.ts planning       → scrape Planning Commission only
//   tsx scraper/run.ts bos            → scrape Board of Supervisors only
//   tsx scraper/run.ts hearings       → scrape Public Hearing Notices only
//   tsx scraper/run.ts extract        → run LLM extraction on unprocessed meetings
const filter = process.argv[2]?.toLowerCase();

const sources: Array<{ id: string; fn: () => Promise<void> }> = [
  { id: 'planning', fn: scrapePlanning },
  { id: 'bos',      fn: scrapeBos },
  { id: 'hearings', fn: scrapeHearings },
];

async function main() {
  // Special command: re-run LLM extraction on all stored meetings
  if (filter === 'extract') {
    console.log('\n=== LLM extraction pass ===');
    await extractPlanning();
    console.log('\nAll done.');
    return;
  }

  const toRun = filter ? sources.filter((s) => s.id === filter) : sources;

  if (toRun.length === 0) {
    console.error(`Unknown source: "${filter}". Available: ${sources.map((s) => s.id).join(', ')}, extract`);
    process.exit(1);
  }

  for (const { id, fn } of toRun) {
    console.log(`\n=== scraping: ${id} ===`);
    try {
      await fn();
    } catch (err) {
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
