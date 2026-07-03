import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Auth-bound server client. Reads the user's session from cookies (synced from
// the browser via @supabase/ssr's createBrowserClient) so server components
// read AS the signed-in user, not as anon. This is the launch gate — without
// it, server reads can only see anon-permitted rows.
//
// Falls back to anon (no session) gracefully — public routes like /m still
// work via this client (RLS allows anon on the specific public rows).
export function supabaseServer() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: "sb-fs-auth" },
      cookies: {
        get(name: string) { return store.get(name)?.value; },
        set(name: string, value: string, options: any) {
          try { store.set({ name, value, ...options }); } catch {
            /* read-only context (RSC); ignore */
          }
        },
        remove(name: string, options: any) {
          try { store.set({ name, value: "", ...options, maxAge: 0 }); } catch {}
        },
      },
    }
  );
}
