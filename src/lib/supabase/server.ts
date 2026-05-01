import { createClient } from '@supabase/supabase-js';

// Anon-key client for server-side reads inside React Server Components.
// Reads are gated by RLS policies in 0001_init.sql (public select on all tables).
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.example to .env.local and fill them in.',
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
