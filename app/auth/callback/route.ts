import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "@/lib/authCookies";

// Server-side OAuth / magic-link callback — standard Supabase Next.js
// pattern (https://supabase.com/docs/guides/auth/server-side/nextjs).
//
// Why server-side, not the earlier client-side page:
//   The client Page + @supabase/ssr storage adapter kept losing the
//   PKCE code_verifier between signInWithOAuth() and
//   exchangeCodeForSession() (three attempts, three different failure
//   modes, all cookie-related). Doing the exchange in a Route Handler:
//     - reads cookies via next/headers (server-authoritative)
//     - writes session cookies via Set-Cookie response header before
//       the redirect (guaranteed committed by the browser)
//     - keeps the entire secret PKCE handshake off the client
//
// After success the handler redirects to '/' (or ?next= if provided).
// After failure it redirects back to /login with ?error=<message> so
// the login page can surface the real reason.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const errParam = searchParams.get("error");
  const errDesc = searchParams.get("error_description");

  const bounce = (msg: string) => {
    const u = new URL("/login", origin);
    u.searchParams.set("error", msg);
    return NextResponse.redirect(u);
  };

  if (errParam) return bounce(errDesc || errParam);
  if (!code) return bounce("Missing code parameter — did the provider cancel?");

  const cookieStore = cookies();
  const host = headers().get("host");
  const cookieOpts = authCookieOptions(host);
  const { name: _n, ...cookieAttrs } = cookieOpts;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: any) {
          try { cookieStore.set({ name, value, ...cookieAttrs, ...options }); } catch {}
        },
        remove(name: string, options: any) {
          try { cookieStore.set({ name, value: "", ...cookieAttrs, ...options, maxAge: 0 }); } catch {}
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return bounce("Exchange failed: " + error.message);

  // Best-effort: sync profile from any pending team-member invite.
  try { await supabase.rpc("sync_my_profile_from_invite"); } catch {}

  // First-run tour if the profile hasn't seen it yet.
  let dest = next;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase
        .from("profiles").select("first_run_done_at").eq("id", user.id).maybeSingle();
      if (prof && !prof.first_run_done_at) dest = "/welcome";
    }
  } catch {}

  return NextResponse.redirect(new URL(dest, origin));
}
