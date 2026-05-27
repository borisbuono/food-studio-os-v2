import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

// Pure data client (anon). No session, no token refresh, isolated storage key — so it
// never instantiates a competing auth instance against supabaseBrowser in the browser.
export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fs-anon" },
});
