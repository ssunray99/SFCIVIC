// CI diagnostic — runs in the failing job to pinpoint why PGRST125 happens
// for backfill/enrich queries but NOT for the scrape jobs' queries against
// the same tables.
//
// Reports (without leaking secret values):
//   - Env var presence + length + key sanity (URL hostname only; JWT segments)
//   - Three test queries matching the three real query shapes:
//       A) INSERT into scrape_runs (the pattern that works in scrape jobs)
//       B) SELECT meetings ORDER BY meeting_date (backfill's failing shape)
//       C) SELECT agenda_items with .not filter (enrich's failing shape)
//
// The error code/message for each tells us if the bug is auth/connection
// (all three fail) vs. query-shape-specific (only B/C fail).

import { createClient } from '@supabase/supabase-js';

function sanitizeUrl(u: string | undefined): string {
  if (!u) return '(unset)';
  const trimmed = u.trim();
  let parsed: URL | null = null;
  try { parsed = new URL(trimmed); } catch { /* not a URL */ }
  return [
    `len=${u.length}`,
    `trimmedLen=${trimmed.length}`,
    `lenDiff=${u.length - trimmed.length}`,
    parsed ? `protocol=${parsed.protocol}` : 'protocol=(unparseable)',
    parsed ? `host=${parsed.hostname}` : '',
    parsed ? `pathname="${parsed.pathname}"` : '',
    parsed ? `searchEmpty=${parsed.search === ''}` : '',
  ].filter(Boolean).join(' ');
}

function sanitizeKey(k: string | undefined): string {
  if (!k) return '(unset)';
  const trimmed = k.trim();
  const segments = trimmed.split('.').length;
  return `len=${k.length} trimmedLen=${trimmed.length} startsEyJ=${trimmed.startsWith('eyJ')} jwtSegments=${segments}`;
}

async function main() {
  console.log('=== ENV DIAGNOSTIC (no secret values exposed) ===');
  console.log('  SUPABASE_URL:           ', sanitizeUrl(process.env.SUPABASE_URL));
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', sanitizeKey(process.env.SUPABASE_SERVICE_ROLE_KEY));
  console.log('  GEMINI_API_KEY:           len=', process.env.GEMINI_API_KEY?.length ?? 'unset');
  console.log('  NODE_VERSION:           ', process.version);

  // Print supabase-js + node-fetch versions to spot a CI/local skew.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../package.json') as { dependencies: Record<string, string> };
    console.log('  pkg @supabase/supabase-js:', pkg.dependencies['@supabase/supabase-js']);
    console.log('  pkg @google/genai:        ', pkg.dependencies['@google/genai']);
  } catch { /* ignore */ }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('Missing env vars; aborting.');
    process.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('\n=== QUERY A: INSERT scrape_runs (mirror of working scrape pattern) ===');
  const a = await supabase
    .from('scrape_runs')
    .insert({ source_id: 'planning', status: 'diagnostic-probe' })
    .select('id')
    .single();
  console.log('  status:', a.status, a.statusText);
  if (a.error) console.log('  error:', a.error);
  else {
    console.log('  inserted id:', a.data?.id);
    // Clean up the diagnostic row.
    if (a.data?.id) {
      await supabase.from('scrape_runs').delete().eq('id', a.data.id);
    }
  }

  console.log('\n=== QUERY B: SELECT meetings ORDER BY meeting_date (backfill shape) ===');
  const b = await supabase
    .from('meetings')
    .select('id, source_id, title, meeting_date, agenda_url, extraction_status, last_prompt_version, extraction_attempt_count')
    .order('meeting_date', { ascending: false })
    .limit(1);
  console.log('  status:', b.status, b.statusText);
  if (b.error) console.log('  error:', b.error);
  else console.log('  rows:', b.data?.length);

  console.log('\n=== QUERY C: SELECT agenda_items with .not filter (enrich shape) ===');
  const c = await supabase
    .from('agenda_items')
    .select('matter_file_number')
    .not('matter_file_number', 'is', null)
    .limit(1);
  console.log('  status:', c.status, c.statusText);
  if (c.error) console.log('  error:', c.error);
  else console.log('  rows:', c.data?.length);

  console.log('\n=== QUERY D: SELECT meetings (no order, no filter) — minimal shape ===');
  const d = await supabase.from('meetings').select('id').limit(1);
  console.log('  status:', d.status, d.statusText);
  if (d.error) console.log('  error:', d.error);
  else console.log('  rows:', d.data?.length);

  console.log('\n=== QUERY E: HEAD count on meetings ===');
  const e = await supabase.from('meetings').select('*', { count: 'exact', head: true });
  console.log('  status:', e.status, e.statusText);
  if (e.error) console.log('  error:', e.error);
  else console.log('  count:', e.count);

  console.log('\n=== QUERY F: SELECT meetings with .eq filter (mirror of scrape\'s freshness check) ===');
  const f = await supabase
    .from('meetings')
    .select('id, extraction_status, last_prompt_version')
    .eq('source_id', 'planning')
    .limit(1)
    .maybeSingle();
  console.log('  status:', f.status, f.statusText);
  if (f.error) console.log('  error:', f.error);
  else console.log('  data:', f.data ? 'one row' : 'null');

  console.log('\n=== Raw fetch test (bypass supabase-js to see if URL format itself is the issue) ===');
  const restUrl = `${url}/rest/v1/meetings?select=id&limit=1`;
  console.log('  GET', restUrl.replace(/^https:\/\/[^.]+\./, 'https://<REDACTED>.'));
  try {
    const res = await fetch(restUrl, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    console.log('  status:', res.status, res.statusText);
    const text = await res.text();
    console.log('  body (first 200 chars):', text.slice(0, 200));
  } catch (err) {
    console.log('  fetch error:', err instanceof Error ? err.message : err);
  }

  console.log('\n=== Diagnostic done ===');
}

main().catch((err) => {
  console.error('uncaught:', err);
  process.exit(1);
});
