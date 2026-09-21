// Server-only service-role client for jobs that run WITHOUT a user
// session (Vercel cron, invoice ingest side-effects).
//
// Why: every recipes / purchase_lines / ingredient_aliases policy is
// `auth.role() = 'authenticated'`. A cron request authenticated only by
// CRON_SECRET hits supabaseServer() with no cookie → anon → RLS returns
// zero rows and updates touch zero rows, silently. That is how a nightly
// job "succeeds" and changes nothing.
//
// Returns null when SUPABASE_SERVICE_ROLE_KEY is not set, so callers can
// report "skipped: no service key" instead of pretending to have run.
// NEVER import from a Client Component.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function supabaseService(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fs-service" },
      })
    : null;
  return cached;
}
