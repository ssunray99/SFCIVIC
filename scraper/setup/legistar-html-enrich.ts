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

      // Set year filter to "All Years" so 2025 and earlier file numbers are found.
      // lstYears is a Telerik RadComboBox (readonly input) — open via click, then pick.
      await page.locator('#ctl00_ContentPlaceHolder1_lstYears_Input').click();
      const allYearsOpt = page.locator('li.rcbItem, .rcbList li').filter({ hasText: /^All Years$/ }).first();
      if (await allYearsOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
        await allYearsOpt.click();
      } else {
        await page.keyboard.press('Escape');
      }

      // Uncheck text/attachments/other — search by File # only to avoid false positives
      // where an omnibus "Petitions and Communications" item references the number.
      await page.locator('#ctl00_ContentPlaceHolder1_chkText').uncheck();
      await page.locator('#ctl00_ContentPlaceHolder1_chkAttachments').uncheck();
      await page.locator('#ctl00_ContentPlaceHolder1_chkOther').uncheck();

      // Fill the search box. Legistar's basic search input has a stable ID.
      const fileInput = page.locator('#ctl00_ContentPlaceHolder1_txtSearch');
      await fileInput.fill(fileNumber);

      // Submit via the visible search button.
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20_000 }),
        page.locator('#visibleSearchButton').click(),
      ]);

      // Find the matching result row by checking only the FIRST cell (File # column).
      // Checking any cell causes false positives when P&C omnibus items reference
      // the searched number in a non-File# column.
      const detailUrl = await page.evaluate(`(() => {
        const fn = ${JSON.stringify(fileNumber)};
        for (const row of Array.from(document.querySelectorAll('tr'))) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 2) continue;
          const fileCell = (cells[0].textContent || '').trim().replace(/\\s+/g, '');
          if (fileCell === fn) {
            const link = row.querySelector('a[href*="LegislationDetail"]');
            return link ? link.href : null;
          }
        }
        return null;
      })()`) as string | null;

      if (!detailUrl) {
        // Log the first result row cells to diagnose format mismatches.
        const firstRowCells = await page.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll('tr'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td')).map(td => (td.textContent||'').trim().slice(0,40));
            if (cells.length >= 2) return cells.slice(0, 5);
          }
          return [];
        })()`) as string[];
        console.warn(`[legistar-enrich] no detail URL for ${fileNumber} — first result cells: ${JSON.stringify(firstRowCells)}`);
        failed++;
        await sleep(THROTTLE_MS);
        continue;
      }

      // Navigate to the matter detail page.
      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });

      // Extract matter metadata. Passed as a string so esbuild never transforms
      // it and its __name() helper is never injected into the browser context.
      const matter = await page.evaluate(`(() => {
        const fieldValue = (labelText) => {
          const labels = Array.from(document.querySelectorAll('span, td, th, label'));
          for (const el of labels) {
            const text = (el.textContent || '').trim();
            // Skip container elements — field labels are short (< 60 chars).
            if (text.length > 60) continue;
            if (text.toLowerCase().includes(labelText.toLowerCase())) {
              const next = el.nextElementSibling
                || (el.closest('tr') ? el.closest('tr').querySelector('td:last-child') : null);
              return next ? next.textContent.replace(/\\s+/g, ' ').trim() : null;
            }
          }
          return null;
        };

        // The page-level <h1> is always "Legislation Details" (Legistar template).
        // The actual matter title lives in a specific ASP.NET label element.
        // That element is a container — its textContent includes navigation tab
        // text ("DetailsReports") followed by the metadata grid. Strip from that
        // marker onward to get just the legislative title text.
        const titleEl = document.querySelector('#ctl00_ContentPlaceHolder1_lblTitle2') ||
          document.querySelector('[id*="lblTitle2"]') ||
          document.querySelector('[id*="lblTitle1"]');
        const rawTitleText = titleEl
          ? (titleEl.textContent || '').replace(/\\s+/g, ' ').trim()
          : '';
        const title = rawTitleText.split('DetailsReports')[0].trim() || null;

        // The real legislative history table uniquely has a "Ver." column header.
        // The real legislative history table has both a "Ver." column and a "Date"
        // column. Multi-version matters also have a Versions summary table that has
        // "Ver." but NO "Date" — requiring both prevents that table from matching
        // first and being parsed with the wrong column mapping.
        const history = [];
        for (const table of Array.from(document.querySelectorAll('table'))) {
          const ths = Array.from(table.querySelectorAll('th'));
          const headers = ths.map(th => (th.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase());
          const hasVer = headers.some(h => h === 'ver.' || h === 'ver' || h.startsWith('ver'));
          const hasDate = headers.some(h => h === 'date' || h === 'action date');
          if (!hasVer || !hasDate) continue;

          // Map column indices dynamically so order changes don't break us.
          let dateIdx = 0, actionIdx = -1, bodyIdx = -1, resultIdx = -1;
          headers.forEach((h, i) => {
            if (h === 'date' || h === 'action date') dateIdx = i;
            if (h === 'action' || (h.startsWith('action') && !h.includes('by') && !h.includes('detail') && !h.includes('date'))) {
              if (actionIdx === -1) actionIdx = i;
            }
            if (h.includes('action by') || h === 'by') bodyIdx = i;
            if (h.includes('result')) resultIdx = i;
          });

          for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
            const cells = Array.from(row.querySelectorAll('td'))
              .map(td => (td.textContent || '').replace(/\\s+/g, ' ').trim());
            if (cells.length < 2) continue;
            history.push({
              action_date: cells[dateIdx] || '',
              action: actionIdx >= 0 ? (cells[actionIdx] || '') : (cells[3] || ''),
              body: bodyIdx >= 0 ? (cells[bodyIdx] || '') : (cells[2] || ''),
              result: resultIdx >= 0 ? (cells[resultIdx] || '') : (cells[4] || ''),
            });
          }
          break;
        }

        const t = (v, max) => v ? String(v).replace(/\\s+/g, ' ').trim().slice(0, max) : null;
        return {
          title: t(title, 1000),
          matter_type: t(fieldValue('Type') || fieldValue('Matter Type'), 200),
          status: t(fieldValue('Status'), 200),
          current_body: t(fieldValue('Current Controlling Body') || fieldValue('In control') || fieldValue('Body'), 200),
          sponsor: t(fieldValue('Sponsor') || fieldValue('Sponsors'), 500),
          intro_date: t(fieldValue('Introduced') || fieldValue('Intro Date') || fieldValue('File created'), 50),
          final_action_date: t(fieldValue('Final Action') || fieldValue('Final action') || fieldValue('Enactment Date'), 50),
          history,
        };
      })()`) as {
        title: string | null;
        matter_type: string | null;
        status: string | null;
        current_body: string | null;
        sponsor: string | null;
        intro_date: string | null;
        final_action_date: string | null;
        history: Array<{ action_date: string; action: string; body: string; result: string }>;
      };

      // Parse date strings to ISO format. Only accept M/D/YYYY or MM/DD/YYYY
      // to avoid misinterpreting file numbers or other strings as dates.
      function parseLegistarDate(raw: string | null): string | null {
        if (!raw) return null;
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw.trim())) return null;
        const d = new Date(raw.trim());
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
        // Insert history rows. Filter AFTER date parsing so rows whose
        // "date" cell contains a label string (e.g. "Name:", "Status:") are
        // excluded — those are metadata rows embedded in the history table tbody.
        if (matter.history.length > 0) {
          const historyRows = matter.history
            .map((h) => ({
              matter_file_number: fileNumber,
              action_date: parseLegistarDate(h.action_date),
              action: h.action || null,
              body: h.body || null,
              result: h.result || null,
            }))
            .filter((h) => h.action_date !== null);

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
