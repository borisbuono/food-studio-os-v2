import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME, browserAuthCookieOptions } from "@/lib/authCookies";

// THE single browser auth client.
//
// PKCE storage fix (Boris 2026-08-16 15:10):
//   Debug pane showed the sb-fs-auth-code-verifier COOKIE was present on
//   the callback page but exchangeCodeForSession reported "verifier not
//   found in storage". Root cause: @supabase/ssr's storage adapter reads
//   the verifier from localStorage under the hood, not from the mirrored
//   cookie. When localStorage is empty (Incognito, or wiped by hardReset)
//   the SDK sees no verifier even though the cookie exists.
//
// Fix: pass an explicit `auth.storage` pointing at window.localStorage +
// a matching `storageKey`. Now signInWithOAuth writes the verifier to
// localStorage and exchangeCodeForSession reads it back from the same
// place. cookieOptions is still passed so session-cookie mirroring for
// SSR reads continues to work.

const memoryStorage: Record<string, string> = {};
const isoStorage = {
  getItem: (k: string) => memoryStorage[k] ?? null,
  setItem: (k: string, v: string) => { memoryStorage[k] = v; },
  removeItem: (k: string) => { delete memoryStorage[k]; },
};

export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    cookieOptions: browserAuthCookieOptions(),
    auth: {
      flowType: "pkce",
      storage: typeof window !== "undefined" ? window.localStorage : isoStorage,
      storageKey: AUTH_COOKIE_NAME,
    },
  }
);
