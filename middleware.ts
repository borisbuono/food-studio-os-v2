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
  // Public lead-capture form — placeholder shipped overnight 2026-09-11.
  // The comm/design agent replaces the component; the path stays public.
  "/leads/capture",
  // Self-serve onboarding step 1 is the sign-up gate — must be reachable
  // signed-out. Steps 2-5 run their own auth check server-side and
  // redirect back to /onboard/step-1 with a bounced session.
  "/onboard/step-1",
  // Team invitation landing — the recipient hits /team/join?token=... straight
  // from the invitation email BEFORE they have a session. The page itself uses
  // the get_invitation_by_token RPC to resolve the token; the finalize route
  // is called only after magic-link sign-in and is not public.
  "/team/join",
  // Public job application page — candidates arrive from an Instagram /
  // WhatsApp link with no account. Posts to /api/public/apply/<slug>.
  "/apply/",
  // Public booking page (Cal.com model) — visitors and interview candidates
  // pick a slot with no account. Posts to /api/public/book/<slug>.
  "/book/",
];

const PUBLIC_PAGE_EXACT = new Set<string>([
  "/welcome",
  "/login",
  "/booking-terms",
  "/leads/capture",
  "/onboard/step-1",
  "/team/join",
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
  // Public lead capture — rate-limited + honeypot-guarded in the route.
  "/api/leads/capture",
  // Meta inbox drafter — called by the Postgres insert trigger (pg_net) and
  // meta-inbox-pull with the Vault-minted x-inbox-secret; the route checks
  // it through social_inbox_secret_ok(). Writes drafts only, never sends.
  "/api/inbox/draft",
  // Nightly recipe-cost refresh, called by /api/cron/pos-nightly with the
  // CRON_SECRET bearer. The route itself rejects anything without the
  // secret or a signed-in session.
  "/api/recipes/compute-all-entities",
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

// Public recipe pages — /recipes/<slug> (Boris ruling 2026-09-21). Only a
// single non-UUID slug segment: /recipes, /recipes/<uuid>, /recipes/<id>/edit
// and /recipes/<id>/cook stay behind the auth wall. The page reads through
// the public_recipe_by_slug RPC, which only returns reviewed + published rows.
const PUBLIC_RECIPE_SLUG = /^\/recipes\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;
const UUID_SEGMENT = /^\/recipes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_EXACT.has(pathname)) return true;
  if (PUBLIC_RECIPE_SLUG.test(pathname) && !UUID_SEGMENT.test(pathname)) return true;
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

// -----------------------------------------------------------------------------
// House-scope binding — 2026-09-22 (Boris walk: Recipes / Reach calendar
// dropped him from Bistro Mondo back into Studio).
// -----------------------------------------------------------------------------
// The three-level scope model (lib/scope.ts) makes /h/<slug>/** URL-scoped
// and every legacy path (/develop/*, /boh, /office, /administrate/*, …)
// COOKIE-scoped via fs_entity. The /h/<slug> pages were meant to bind that
// cookie on entry, but they did it with cookies().set() inside a Server
// Component render — which Next 14 refuses ("Cookies can only be modified
// in a Server Action or Route Handler") — inside a try/catch that swallowed
// the error. So entering a house never bound the cookie: it stayed on the
// sign-in value (holdings for an owner), and the first legacy link in the
// house sidebar resolved against holdings → Studio brand + Holdings tree.
//
// Middleware CAN set cookies, and it runs before the render, so this is the
// one place the binding is reliable. On an authenticated, non-prefetch
// request to /h/<slug>/** we resolve the slug against `entities` (RLS-
// scoped — a user who is not a member sees no row and nothing is written),
// forward the cookie to this request's server components, and persist it
// on the response with the same attributes /auth/callback uses so there is
// ONE fs_entity cookie on prod (task #27 — a host-only twin used to win).
//
// Prefetches are skipped on purpose: hovering a house tile on /studio/houses
// fires a prefetch of /h/<slug>, and binding on that would silently move the
// user into a house they never clicked.
const HOUSE_PATH = /^\/h\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/i;

function houseSlugFromPath(pathname: string): string | null {
  const m = HOUSE_PATH.exec(pathname);
  return m ? m[1].toLowerCase() : null;
}

function isPrefetch(request: NextRequest): boolean {
  const h = request.headers;
  if (h.get("next-router-prefetch") === "1") return true;
  if ((h.get("purpose") || "").toLowerCase() === "prefetch") return true;
  if ((h.get("sec-purpose") || "").toLowerCase().includes("prefetch")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // Still run the Supabase cookie plumbing so signed-in visitors get their
    // session refreshed on the way through.
    return await withSupabaseSession(request, () => null);
  }

  return await withSupabaseSession(request, async (user, supabase) => {
    if (user) {
      // Authenticated → let it through, binding the house cookie on /h/<slug>.
      const slug = houseSlugFromPath(pathname);
      if (!slug || isPrefetch(request)) return null;
      let entityId: string | null = null;
      try {
        const { data } = await supabase
          .from("entities")
          .select("id")
          .eq("slug", slug)
          .eq("entity_type", "operating_venue")
          .eq("status", "active")
          .maybeSingle();
        entityId = (data as { id?: string } | null)?.id ?? null;
      } catch {
        entityId = null;
      }
      if (!entityId) return null;
      if (request.cookies.get("fs_entity")?.value === entityId) return null;
      // Forward to THIS request's server components (layout.tsx seeds the
      // sidebar's initialEntity from it) and persist for the next one.
      request.cookies.set("fs_entity", entityId);
      const bound = NextResponse.next({ request });
      bound.cookies.set({
        ...houseCookieAttrs(request.headers.get("host")),
        name: "fs_entity",
        value: entityId,
      });
      return bound;
    }

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

// fs_entity attributes: the auth cookie's domain/secure/sameSite (so prod
// gets domain=.foodstudio.ai, previews stay host-only) + root path + 1 year,
// matching /auth/callback and /invite/accept.
function houseCookieAttrs(host: string | null) {
  const { name: _n, ...attrs } = authCookieOptions(host);
  return { ...attrs, path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
}

type SessionClient = ReturnType<typeof createServerClient>;

async function withSupabaseSession(
  request: NextRequest,
  decide: (user: { id: string } | null, supabase: SessionClient) => NextResponse | null | Promise<NextResponse | null>,
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

  const decision = await decide(user, supabase);
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
