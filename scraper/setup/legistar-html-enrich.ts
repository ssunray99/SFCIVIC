// M14: Legistar HTML enrichment
//
// Reads distinct matter_file_numbers from agenda_items that are not yet in the
// legislation table, visits sfgov.legistar.com matter detail pages via Playwright,
// and populates legislation + legislation_history rows.
//
// Run: npm run enrich:legislation
//
// The Legistar Web API is not viable for SF (data frozen at 2020, Histories 500s,
// Events 400s). HTML scraping of sfgov.legistar.com is the only viable source
// for current matter metadata.

import { newContext } from '../lib/playwright.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

const LEGISTAR_BASE = 'https://sfgov.legistar.com';
const LEGISLATION_URL = `${LEGISTAR_BASE}/Legislation.aspx`;

// How long to wait between matter fetches to avoid hammering Legistar.
const THROTTLE_MS = 1500;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const supabase = createAdminClient();

  // 1. Collect matter_file_numbers not yet in the legislation table.
  const { data: itemRows, error: itemErr } = await supabase
    .from('agenda_items')
    .select('matter_file_number')
    .not('matter_file_number', 'is', null);

  if (itemErr) throw itemErr;

  const allFileNumbers = [
    ...new Set(
      (itemRows ?? [])
        .map((r) => r.matter_file_number as string)
        .filter(Boolean),
    ),
  ];

  const { data: existing } = await supabase
    .from('legislation')
    .select('matter_file_number');

  const existingSet = new Set((existing ?? []).map((r) => r.matter_file_number));
  const toEnrich = allFileNumbers.filter((n) => !existingSet.has(n));

  console.log(
    `[legistar-enrich] ${toEnrich.length} matter(s) to enrich ` +
      `(${existingSet.size} already in legislation table)`,
  );

  if (toEnrich.length === 0) {
    console.log('[legistar-enrich] nothing to do');
    return;
  }

  const ctx = await newContext();
  const page = await ctx.newPage();

  // 2. Navigate once to the Legislation search page and set it up.
  console.log(`[legistar-enrich] loading ${LEGISLATION_URL}`);
  await page.goto(LEGISLATION_URL, { waitUntil: 'networkidle', timeout: 45_000 });

  let enriched = 0;
  let failed = 0;

  for (const fileNumber of toEnrich) {
    console.log(`[legistar-enrich] searching: ${fileNumber}`);

    try {
      // Navigate back to search page for each matter.
      await page.goto(LEGISLATION_URL, { waitUntil: 'networkidle', timeout: 30_000 });

      // Fill the File # field. Legistar uses ASP.NET Web Forms; we find the
      // input by its label text rather than fragile auto-generated IDs.
      const fileInput = page.locator('input[id*="FileNumber"], input[id*="tbFile"]').first();
      await fileInput.fill(fileNumber);

      // Submit the search form.
      const searchBtn = page
        .locator('input[type="submit"][value*="Search"], a:has-text("Search")')
        .first();
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20_000 }),
        searchBtn.click(),
      ]);

      // Find the matching result row (first row whose file number matches).
      const detailUrl = await page.evaluate(
        (fn: string): string | null => {
          const rows = Array.from(document.querySelectorAll('tr'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            const fileCell = cells.find(
              (td) => td.textContent?.trim().replace(/\s+/g, '') === fn,
            );
            if (fileCell) {
              const link = row.querySelector('a[href*="LegislationDetail"]') as HTMLAnchorElement | null;
              return link?.href ?? null;
            }
          }
          return null;
        },
        fileNumber,
      );

      if (!detailUrl) {
        console.warn(`[legistar-enrich] no detail URL found for ${fileNumber}`);
        failed++;
        await sleep(THROTTLE_MS);
        continue;
      }

      // Navigate to the matter detail page.
      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      // Extract matter metadata from the detail page.
      const matter = await page.evaluate((): {
        title: string | null;
        matter_type: string | null;
        status: string | null;
        current_body: string | null;
        sponsor: string | null;
        intro_date: string | null;
        final_action_date: string | null;
        history: Array<{ action_date: string; action: string; body: string; result: string }>;
      } => {
        function fieldValue(labelText: string): string | null {
          const labels = Array.from(document.querySelectorAll('span, td, th, label'));
          for (const el of labels) {
            if (el.textContent?.trim().toLowerCase().includes(labelText.toLowerCase())) {
              const next =
                el.nextElementSibling ??
                el.closest('tr')?.querySelector('td:last-child') ??
                null;
              return next?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
            }
          }
          return null;
        }

        const title =
          document.querySelector('h1, .title, [class*="title"]')?.textContent?.replace(/\s+/g, ' ').trim() ??
          null;

        // History table: look for a table with date, action, body columns.
        const history: Array<{ action_date: string; action: string; body: string; result: string }> = [];
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('th')).map((th) =>
            th.textContent?.trim().toLowerCase() ?? '',
          );
          if (headers.some((h) => h.includes('date')) && headers.some((h) => h.includes('action'))) {
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td')).map(
                (td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              );
              if (cells.length >= 2) {
                history.push({
                  action_date: cells[0] ?? '',
                  action: cells[1] ?? '',
                  body: cells[2] ?? '',
                  result: cells[3] ?? '',
                });
              }
            }
            break;
          }
        }

        return {
          title,
          matter_type: fieldValue('Type') ?? fieldValue('Matter Type'),
          status: fieldValue('Status'),
          current_body: fieldValue('Current Controlling Body') ?? fieldValue('Body'),
          sponsor: fieldValue('Sponsor') ?? fieldValue('Sponsors'),
          intro_date: fieldValue('Introduced') ?? fieldValue('Intro Date'),
          final_action_date: fieldValue('Final Action') ?? fieldValue('Enactment Date'),
          history,
        };
      });

      // Parse date strings to ISO format (Legistar typically shows M/D/YYYY).
      function parseLegistarDate(raw: string | null): string | null {
        if (!raw) return null;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }

      const legislationRow = {
        matter_file_number: fileNumber,
        title: matter.title,
        matter_type: matter.matter_type,
        status: matter.status,
        current_body: matter.current_body,
        sponsor: matter.sponsor,
        intro_date: parseLegistarDate(matter.intro_date),
        final_action_date: parseLegistarDate(matter.final_action_date),
        url: detailUrl,
        enriched_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('legislation')
        .upsert(legislationRow, { onConflict: 'matter_file_number' });

      if (upsertErr) {
        console.error(`[legistar-enrich] upsert error for ${fileNumber}:`, upsertErr.message);
        failed++;
      } else {
        // Insert history rows.
        if (matter.history.length > 0) {
          const historyRows = matter.history
            .filter((h) => h.action_date)
            .map((h) => ({
              matter_file_number: fileNumber,
              action_date: parseLegistarDate(h.action_date),
              action: h.action || null,
              body: h.body || null,
              result: h.result || null,
            }));

          if (historyRows.length > 0) {
            // Delete existing history then re-insert so it stays fresh.
            await supabase
              .from('legislation_history')
              .delete()
              .eq('matter_file_number', fileNumber);
            await supabase.from('legislation_history').insert(historyRows);
          }
        }

        enriched++;
        console.log(
          `[legistar-enrich] ✓ ${fileNumber} — ${matter.title ?? '(no title)'} (${matter.status ?? 'unknown status'})`,
        );
      }
    } catch (err) {
      console.error(
        `[legistar-enrich] error for ${fileNumber}:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
    }

    await sleep(THROTTLE_MS);
  }

  await ctx.close();

  console.log(
    `[legistar-enrich] done — ${enriched} enriched, ${failed} failed out of ${toEnrich.length} total`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
