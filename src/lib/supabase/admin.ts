import { createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses RLS. Only ever used by the scraper —
// never imported from anything under src/app/ or src/components/.
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
