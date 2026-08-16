import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "@/lib/authCookies";

// Auth-bound server client. Cookie options derived from the request host
// so SSR writes cookies that match what the browser wrote.
export function supabaseServer() {
  const store = cookies();
  const host = headers().get("host");
  const cookieOpts = authCookieOptions(host);
  // strip `name` — the Set-Cookie API takes the actual cookie name (e.g.
  // sb-fs-auth-token) as its first arg, not the prefix; only domain / path /
  // sameSite / secure / maxAge from cookieOpts apply to each write.
  const { name: _n, ...cookieAttrs } = cookieOpts;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        get(name: string) { return store.get(name)?.value; },
        set(name: string, value: string, options: any) {
          try { store.set({ name, value, ...cookieAttrs, ...options }); } catch {
            /* RSC read-only; ignore */
          }
        },
        remove(name: string, options: any) {
          try { store.set({ name, value: "", ...cookieAttrs, ...options, maxAge: 0 }); } catch {}
        },
      },
    }
  );
}
