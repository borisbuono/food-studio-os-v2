import { createClient } from "@supabase/supabase-js";

// THE single browser auth client. Owns the session under its own storage key so it
// can never collide with the anon data client (collision = "logged out / profile swap").
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "fs-auth" } }
);
