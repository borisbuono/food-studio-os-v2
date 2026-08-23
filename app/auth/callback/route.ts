import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "@/lib/authCookies";

// Server-side OAuth / magic-link callback — standard Supabase Next.js
// pattern (https://supabase.com/docs/guides/auth/server-side/nextjs).
//
// CRITICAL: session cookies MUST be written to the NextResponse we return,
// not to the request-side `cookies()` store. Setting via next/headers
// cookies().set() inside a Route Handler does NOT propagate to a
// NextResponse.redirect() that we build separately — the Set-Cookie
// headers get dropped and the browser never receives the session.
// So we build the response object first, then have the SDK write cookies
// directly on it via response.cookies.set().

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const errParam = searchParams.get("error");
  const errDesc = searchParams.get("error_description");

  const host = headers().get("host");
  const cookieOpts = authCookieOptions(host);
  const { name: _n, ...cookieAttrs } = cookieOpts;

  const bounce = (msg: string) => {
    const u = new URL("/login", origin);
    u.searchParams.set("error", msg);
    return NextResponse.redirect(u);
  };

  if (errParam) return bounce(errDesc || errParam);
  if (!code) return bounce("Missing code parameter — did the provider cancel?");

  // Build the response we intend to return FIRST — session cookies will be
  // written directly on this object below by the SDK.
  const response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        // Read from the request-side cookies (what the browser sent).
        get(name: string) { return request.cookies.get(name)?.value; },
        // Write to the RESPONSE cookies (what the browser will receive).
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options, ...cookieAttrs });
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", ...options, ...cookieAttrs, maxAge: 0 });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return bounce("Exchange failed: " + error.message);

  // Best-effort: sync profile from any pending team-member invite.
  try { await supabase.rpc("sync_my_profile_from_invite"); } catch {}

  // First-run tour concept was removed 2026-08-23 — the redirect to /welcome
  // caused a sign-in loop because /welcome doesn't detect signed-in state and
  // profiles.first_run_done_at was NULL for every user (nothing sets it). If a
  // first-run tour is added later, do it as a client-side modal on / rather
  // than a server redirect, so an unset value can't loop the login flow.

  return response;
}
