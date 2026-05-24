import { createClient } from "@supabase/supabase-js";

// Browser client that PERSISTS the session — used for sign-in.
// Separate from lib/supabase.ts (persistSession:false) which serves anon reads/SSR.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
