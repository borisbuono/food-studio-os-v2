import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { headers } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authCookieOptions } from "@/lib/authCookies";

// /auth/confirm?token_hash=…&type=invite|magiclink&next=/invite/accept?token=…
//
// Token-hash verification for emailed links (team invites, 2026-09-21).
// Unlike /auth/callback (PKCE code exchange), verifyOtp() needs no code
// verifier cookie, so the link works in whichever browser the invitee opens
// it — the sender's browser never has to be involved.
//
// Public by middleware (/auth/ prefix). `next` is restricted to same-origin
// relative paths.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = (searchParams.get("type") || "magiclink") as EmailOtpType;
  const rawNext = searchParams.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const bounce = (msg: string) => {
    const u = new URL("/login", origin);
    u.searchParams.set("error", msg);
    u.searchParams.set("next", next);
    return NextResponse.redirect(u);
  };
  if (!token_hash) return bounce("Missing token — request a fresh invite link.");

  const host = headers().get("host");
  const cookieOpts = authCookieOptions(host);
  const { name: _n, ...cookieAttrs } = cookieOpts;
  const response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options, ...cookieAttrs });
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", ...options, ...cookieAttrs, maxAge: 0 });
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) return bounce("Link expired or already used — sign in with the invited email to continue.");
  return response;
}
