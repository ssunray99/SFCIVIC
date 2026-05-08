import { createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses RLS. Only ever used by the scraper —
// never imported from anything under src/app/ or src/components/.
//
// Defensively normalise SUPABASE_URL because two paste-time mistakes have
// caused PGRST125 ("Invalid path specified in request URL") in CI:
//   1. Trailing newline / whitespace from paste-into-secret-UI.
//   2. Including the `/rest/v1/` (or other API prefix) in the URL — that's
//      what supabase-js appends, so a doubled prefix gives 404s like
//      "/rest/v1//rest/v1/meetings".
// Strip both so the value works regardless of how it was pasted.
export function createAdminClient() {
  const url = normaliseSupabaseUrl(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
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

/**
 * Trim whitespace + strip any API path the user may have included
 * (`/rest/v1/`, `/auth/v1/`, `/storage/v1/`, etc.) and any trailing slash.
 * Exported for reuse by smoke scripts and tests.
 */
export function normaliseSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .trim()
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}
