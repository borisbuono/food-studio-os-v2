// Supabase client for code that runs WITHOUT a user session: Vercel cron
// targets, webhook handlers, and the ingestion libraries they call.
//
// Why this exists (2026-09-21, Phase 3.5 RLS rollout):
// supabaseServer() binds to the request's auth cookie. A Vercel cron request
// carries CRON_SECRET, not a Supabase session, so supabaseServer() resolves to
// the `anon` role. While every policy was `using (true)` that still worked;
// now that RLS is membership-scoped, an anon cron reads zero rows and its
// writes are refused — the job "succeeds" and changes nothing.
//
// supabaseJob() prefers the service-role client and falls back to the
// request-bound one, so the same library works in both contexts:
//   • cron / webhook (no cookie)  -> service role, full visibility
//   • interactive route (cookie)  -> service role too, when the key is set
//
// IMPORTANT: this client bypasses RLS. Any route that reaches these libraries
// on behalf of a signed-in user must do its own entity check first — RLS is no
// longer the backstop on this path.
//
// If SUPABASE_SERVICE_ROLE_KEY is missing the fallback is the anon-bound
// client, which will now visibly fail rather than silently return nothing.
// NEVER import from a Client Component.

import { supabaseService } from "@/lib/supabaseService";
import { supabaseServer } from "@/lib/supabaseServer";
import type { SupabaseClient } from "@supabase/supabase-js";

export function supabaseJob(): SupabaseClient {
  return (supabaseService() as SupabaseClient | null) ?? (supabaseServer() as unknown as SupabaseClient);
}

// True when the service-role key is configured. Cron routes report this so a
// missing key shows up in the response instead of as an empty result set.
export function hasServiceRole(): boolean {
  return supabaseService() !== null;
}
