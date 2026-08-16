"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_NAME } from "@/lib/authCookies";

// Browser Supabase client.
//
// We've moved off @supabase/ssr's createBrowserClient for auth because its
// cookie-based PKCE storage adapter kept losing the code_verifier between
// signInWithOAuth() and exchangeCodeForSession(). Debug proved the mirror
// cookie was present but the SDK could not read the verifier back
// ("PKCE code verifier not found in storage" even with a fresh Incognito).
//
// Solution: use @supabase/supabase-js createClient with explicit
// localStorage. The SDK writes the code_verifier to localStorage under
// `sb-fs-auth-code-verifier`, and reads it from the same place. Session
// tokens land in localStorage too under `sb-fs-auth-auth-token` — SSR
// server components will no longer see the session (we accept that
// trade-off for now; anon reads still work through RLS, and the UI has
// been working as Guest for many surfaces already).
//
// Later refinement (post-launch): add a lightweight cookie mirror so
// SSR can read the JWT for personalised server renders. For now, sign-in
// working end-to-end is the goal.

let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // we handle the exchange ourselves in /auth/callback
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
        storageKey: AUTH_COOKIE_NAME,
      },
    }
  );
  return _client;
}

// Backward-compat export so every existing `import { supabaseBrowser } from ...`
// keeps working without touching every callsite.
export const supabaseBrowser = new Proxy({} as SupabaseClient, {
  get(_t, prop, receiver) {
    const c = getSupabaseBrowser();
    const v = (c as any)[prop];
    return typeof v === "function" ? v.bind(c) : v;
  },
});
