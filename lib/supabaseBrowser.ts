import { createBrowserClient } from "@supabase/ssr";

// THE single browser auth client. Uses @supabase/ssr so the session is written
// to cookies (not just localStorage) — that's what lets the server client read
// the same session. Existing storageKey "fs-auth" preserved so the
// migration doesn't sign everyone out unnecessarily.
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookieOptions: { name: "sb-fs-auth" } }
);
