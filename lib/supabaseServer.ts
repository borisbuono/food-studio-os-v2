import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "@/lib/authCookies";

// Auth-bound server client.
//
// Uses the getAll/setAll cookies API (required by @supabase/ssr v0.10+
// for correct handling of chunked session cookies like sb-fs-auth.0 +
// sb-fs-auth.1). The older get/set API returned only single cookies at
// a time so the SDK couldn't reassemble chunked tokens — that's why
// supabaseServer().auth.getUser() was returning null even though the
// cookies were on the wire (Boris 2026-08-20 diagnostic confirmed).
export function supabaseServer() {
  const store = cookies();
  const host = headers().get("host");
  const cookieOpts = authCookieOptions(host);
  const { name: _n, ...cookieAttrs } = cookieOpts;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              // Our attrs win over SDK defaults so httpOnly stays false
              // and domain stays on .foodstudio.ai.
              store.set({ name, value, ...options, ...cookieAttrs });
            } catch {
              /* RSC read-only; ignore */
            }
          });
        },
      },
    }
  );
}
