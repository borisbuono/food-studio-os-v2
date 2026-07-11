// Service-role Supabase client for guest self-service API routes.
//
// The /m surface is anon-facing — anon RLS lets guests READ the published menu,
// but WRITING a booking + creating/updating a guests row is an authenticated
// action in the current RLS posture. The public API needs a way to insert on
// the guest's behalf without exposing service-role to the client.
//
// This client lives ONLY on the server (never import from a Client Component)
// and is used exclusively by /api/guest/* routes after they validate the
// incoming payload. Every write here is gated by:
//   - route input validation (party size, dates, email shape)
//   - restaurant slug ownership check
//   - signed-token check (preferences + feedback routes)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

// Fall back to anon so the routes still work in dev (RLS may be permissive
// during the migration window) — production sets SUPABASE_SERVICE_ROLE_KEY.
export const guestServiceClient = createClient(url, service || anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fs-guest-service" },
});
