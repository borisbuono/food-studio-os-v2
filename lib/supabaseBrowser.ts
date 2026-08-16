"use client";
import { createBrowserClient } from "@supabase/ssr";
import { browserAuthCookieOptions } from "@/lib/authCookies";

// Browser Supabase auth client — standard @supabase/ssr pattern.
// signInWithOAuth writes the PKCE code_verifier to a cookie via this
// client's storage adapter. The server-side callback Route Handler
// (app/auth/callback/route.ts) then reads that cookie to complete the
// exchange. Both sides use the same cookie name prefix + attributes
// derived from browserAuthCookieOptions() so they agree.
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookieOptions: browserAuthCookieOptions() }
);
