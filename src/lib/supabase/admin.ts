import { createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses RLS. Only ever used by the scraper —
// never imported from anything under src/app/ or src/components/.
//
// Defensively trim env vars: GitHub Actions secrets occasionally pick up a
// trailing newline at paste time, and a single trailing whitespace in
// SUPABASE_URL produces malformed REST URLs that PostgREST rejects with
// PGRST125 ("Invalid path specified in request URL"). Trimming here means
// we never have to re-diagnose that class of issue.
export function createAdminClient() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'These are required by the scraper and must never be exposed to the browser.',
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
