import { scrape as scrapePlanning, extractExisting as extractPlanning } from './sources/planning.ts';
import { scrape as scrapeBos } from './sources/bos.ts';
import { scrape as scrapeBosLandUse } from './sources/bos-land-use.ts';
import { scrape as scrapeBosBudget } from './sources/bos-budget.ts';
import { scrape as scrapeBosRules } from './sources/bos-rules.ts';
import { scrape as scrapeBosPublicSafety } from './sources/bos-public-safety.ts';
import { scrape as scrapeBosGao } from './sources/bos-gao.ts';
import { scrape as scrapeHpc, extractExisting as extractHpc } from './sources/hpc.ts';
import { scrape as scrapeSfmta } from './sources/sfmta.ts';
import { closeBrowser } from './lib/playwright.ts';

// CLI usage:
//   tsx scraper/run.ts                    → scrape all sources
//   tsx scraper/run.ts planning           → scrape Planning Commission only
//   tsx scraper/run.ts bos                → scrape Board of Supervisors (Full Board) only
//   tsx scraper/run.ts bos-land-use       → scrape Land Use and Transportation Committee only
//   tsx scraper/run.ts bos-budget         → scrape Budget and Appropriations Committee only
//   tsx scraper/run.ts bos-rules          → scrape Rules Committee only
//   tsx scraper/run.ts bos-public-safety  → scrape Public Safety Committee only
//   tsx scraper/run.ts bos-gao            → scrape Government Audit and Oversight Committee only
//   tsx scraper/run.ts hpc                → scrape Historic Preservation Commission only
//   tsx scraper/run.ts sfmta              → scrape SFMTA Board of Directors only
//   tsx scraper/run.ts extract            → run LLM extraction on unprocessed meetings
const filter = process.argv[2]?.toLowerCase();

const sources: Array<{ id: string; fn: () => Promise<void> }> = [
  { id: 'planning',         fn: scrapePlanning },
  { id: 'bos',              fn: scrapeBos },
  { id: 'bos-land-use',     fn: scrapeBosLandUse },
  { id: 'bos-budget',       fn: scrapeBosBudget },
  { id: 'bos-rules',        fn: scrapeBosRules },
  { id: 'bos-public-safety', fn: scrapeBosPublicSafety },
  { id: 'bos-gao',          fn: scrapeBosGao },
  { id: 'hpc',              fn: scrapeHpc },
  { id: 'sfmta',            fn: scrapeSfmta },
];

async function main() {
  // Special command: re-run LLM extraction on all stored meetings
  if (filter === 'extract') {
    console.log('\n=== LLM extraction pass ===');
    await extractPlanning();
    await extractHpc();
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
