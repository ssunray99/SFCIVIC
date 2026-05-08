import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { normaliseSupabaseUrl } from './admin';

// Anon-key client for server-side reads inside React Server Components.
// Reads are gated by RLS policies in 0001_init.sql (public select on all tables).
//
// URL normalisation (same reasoning as admin.ts): a paste-time mistake that
// includes `/rest/v1/` in NEXT_PUBLIC_SUPABASE_URL produces empty pages with
// PGRST125 errors in the server logs. Strip defensively so the site renders
// regardless of how the env var was set.
export function createServerClient() {
  const url = normaliseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.example to .env.local and fill them in.',
    );
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
}
