// One-shot smoke test for the Gemini extraction path.
// Bypasses scraping; calls extractAgendaItems with a tiny synthetic agenda
// so we can confirm the SDK + tool-schema + retry path all work end-to-end.
//
//   npx tsx --env-file=.env.local scraper/setup/smoke-gemini.ts

import { extractAgendaItems } from '../lib/llm.ts';

const SAMPLE = `
SAN FRANCISCO PLANNING COMMISSION
Regular Meeting Agenda — Thursday, May 15, 2026, 1:00 PM
City Hall Room 400, 1 Dr Carlton B Goodlett Place

Item 1.  Case 2024-001234CUA — 1234 Mission Street
         Conditional Use Authorization to convert ground-floor retail to a
         medical office. Request from neighbors to include a bike-parking
         requirement. Staff recommends approval with conditions.

Item 2.  Case 2025-005678DRP — 567 Folsom Street
         Discretionary Review of a permit to add a third-story addition to
         an existing two-story residential building. Comment deadline:
         May 12, 2026. Submit written comments to commissioners@sfgov.org.

Item 3.  Informational — Housing Element Annual Progress Report
         Staff presentation on 2025 housing production targets. No action.
`;

async function main() {
  console.log('[smoke] calling Gemini with synthetic 3-item agenda...');
  const t0 = Date.now();
  const result = await extractAgendaItems(SAMPLE, 'SF Planning Commission Smoke Test');
  const elapsed = Date.now() - t0;

  console.log(`[smoke] ✓ ${elapsed}ms — ${result.items.length} item(s) (model=${result.model}, prompt=${result.promptVersion})`);
  for (const item of result.items) {
    console.log(`  • [${item.item_type}] ${item.title}`);
    console.log(`      summary:        ${item.summary.slice(0, 100)}${item.summary.length > 100 ? '…' : ''}`);
    console.log(`      neighborhoods:  ${item.neighborhoods.join(', ') || '(none)'}`);
    console.log(`      topics:         ${item.topics.join(', ') || '(none)'}`);
    console.log(`      addresses:      ${item.addresses.join(', ') || '(none)'}`);
    console.log(`      file #:         ${item.matter_file_number ?? '(none)'}`);
    console.log(`      comment dl:     ${item.comment_deadline ?? '(none)'}`);
    console.log(`      comment email:  ${item.comment_email ?? '(none)'}`);
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
