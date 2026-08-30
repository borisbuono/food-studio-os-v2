import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/authCookies";

// -----------------------------------------------------------------------------
// Sitewide auth wall — 2026-08-30
// -----------------------------------------------------------------------------
// Boris's hard rule: the OS must be inaccessible without a live session,
// sitewide. He proved the previous per-page opt-in was unsafe by uploading
// 6 photos through /capture while signed out — they landed in storage with no
// DB record. Never again: middleware enforces auth on everything except a
// short allow-list.
//
// Allow-list:
//   * Marketing / sign-in surfaces  — /welcome, /login
//   * OAuth round-trip              — /auth/*  (callback, error, signout)
//   * Guest-facing pages/APIs       — /m/*, /api/guest/* (token-gated already)
//   * Cron endpoints                — /api/cron/*         (CRON_SECRET header)
//   * External webhooks             — Gmail OAuth callback, WhatsApp webhook,
//                                     Fresto webhooks (all have their own auth)
//   * Public API bucket             — /api/public/*
//   * Health probe                  — /api/health
//   * Static assets                 — /_next/*, /public/*, /favicon.ico,
//                                     /icon.png, /apple-icon*, /manifest*,
//                                     /robots.txt, /sitemap.xml, any file
//                                     with an extension
//
// Everything else — including /, /studio, /kitchen, /dining, /office,
// /capture, /develop/*, /boh/*, /foh/*, /administrate/*, and every other
// /api/* route — requires an authenticated Supabase user.
//
// Special case: anon on `/` is redirected to /welcome (not /login?next=/),
// because `/` is the public landing URL people paste. Every other protected
// path redirects to /login?next=<path+query> so the user comes back to where
// they were after signing in.
// -----------------------------------------------------------------------------

const PUBLIC_PAGE_PREFIXES = [
  "/welcome",
  "/login",
  "/auth/",
  "/m/",
  "/booking-terms",
];

const PUBLIC_PAGE_EXACT = new Set<string>([
  "/welcome",
  "/login",
  "/booking-terms",
]);

const PUBLIC_API_PREFIXES = [
  "/api/health",
  "/api/public/",
  "/api/cron/",
  "/api/guest/",
  // Gmail OAuth callback — Google POSTs here with a code.
  "/api/assistant/channels/gmail/callback",
  // Gmail OAuth start — user IS signed in when they click, but the browser
  // may land here after a redirect chain that lost cookies. Gating off is
  // safer than a silent 401 mid-oauth.
  "/api/assistant/channels/gmail/start",
  // WhatsApp webhook — Meta calls this with a signature.
  "/api/assistant/channels/whatsapp/webhook",
  // Fresto push webhooks — Fresto signs the payload.
  "/api/integrations/fresto/webhook/",
];

const PUBLIC_STATIC_EXACT = new Set<string>([
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/manifest.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
]);

const STATIC_PREFIXES = [
  "/_next/",
  "/public/",
  "/brand/",
  "/fonts/",
];

function hasFileExtension(pathname: string): boolean {
  return /\.[a-zA-Z0-9]{2,5}$/.test(pathname);
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_EXACT.has(pathname)) return true;
  if (PUBLIC_STATIC_EXACT.has(pathname)) return true;
  for (const p of PUBLIC_PAGE_PREFIXES) if (pathname.startsWith(p)) return true;
  for (const p of PUBLIC_API_PREFIXES) {
    if (pathname === p) return true;
    if (p.endsWith("/") && pathname.startsWith(p)) return true;
    if (!p.endsWith("/") && pathname.startsWith(p + "/")) return true;
  }
  for (const p of STATIC_PREFIXES) if (pathname.startsWith(p)) return true;
  if (hasFileExtension(pathname)) return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // Still run the Supabase cookie plumbing so signed-in visitors get their
    // session refreshed on the way through.
    return await withSupabaseSession(request, () => null);
  }

  return await withSupabaseSession(request, (user) => {
    if (user) return null; // authenticated → let it through

    // Anon on `/` → /welcome (polite public landing, no ?next dump).
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/welcome";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (isApiPath(pathname)) {
      return new NextResponse(
        JSON.stringify({ error: "unauthenticated" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?next=" + encodeURIComponent(pathname + (search || ""));
    return NextResponse.redirect(url);
  });
}

async function withSupabaseSession(
  request: NextRequest,
  decide: (user: { id: string } | null) => NextResponse | null,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const cookieOpts = authCookieOptions(request.headers.get("host"));
  const { name: _n, ...cookieAttrs } = cookieOpts;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, { ...options, ...cookieAttrs }),
          );
        },
      },
      cookieOptions: cookieOpts,
    },
  );

  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user ? { id: data.user.id } : null;
  } catch {
    user = null;
  }

  const decision = decide(user);
  if (!decision) return supabaseResponse;

  // Copy any refreshed cookies from supabaseResponse onto the decision so
  // the redirect / 401 still carries the rotated session.
  for (const c of supabaseResponse.cookies.getAll()) {
    decision.cookies.set(c.name, c.value, c as any);
  }
  return decision;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-touch-icon|manifest\\.(?:json|webmanifest)|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|json|webmanifest|xml|txt|woff|woff2|ttf|otf|mp3|mp4|wav|ogg|webm|map)$).*)",
  ],
};
