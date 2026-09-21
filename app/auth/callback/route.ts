import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "@/lib/authCookies";
import { E_HOLDINGS, isPrimaryEntity, RESTAURANT_TO_ENTITY } from "@/lib/entities";

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

  // Owner-multi landing (Boris walk 2026-09-10). If the signed-in user is an
  // owner OR carries multiple active memberships, we land them on /studio
  // regardless of the `next` param or the sticky fs_entity cookie. Sticky
  // "last venue" for owners was the root cause of the "sign in and land on
  // Bistro Mondo" report — Boris's entity is the STUDIO, not one of the
  // houses. We also rewrite fs_entity to `holdings` so DesktopSidebar,
  // TopBar and BrandMark render the Studio brand on the first paint
  // instead of flashing the last-visited venue's mark.
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (uid) {
      // Cheap join: auth.uid → team_members.id → memberships. Same shape as
      // lib/memberships.ts, inlined here so we don't spin the whole context
      // builder in a callback that is on the hot login path.
      const { data: tmRows } = await supabase
        .from("team_members")
        .select("id, status")
        .eq("auth_user_id", uid);
      const personIds = (tmRows || [])
        .filter((r: any) => r.status !== "archived")
        .map((r: any) => r.id as string);
      if (personIds.length) {
        const { data: mRows } = await supabase
          .from("memberships")
          .select("role, status, entity_id, is_default")
          .in("person_id", personIds)
          .eq("status", "active");
        const raw = mRows || [];
        const isOwner = raw.some((m: any) => String(m.role || "").toLowerCase() === "owner");
        const isMulti = raw.length > 1;
        // Self-serve tenants (no membership on a pinned Ibiza entity) must
        // never be stamped with the Holdings cookie — that scoped their
        // Studio to Boris's books (stress test 2026-09-21). They get their
        // own default house instead.
        const onPinned = raw.some((m: any) => isPrimaryEntity(m.entity_id));
        const ownDefault = (raw.find((m: any) => m.is_default) || raw[0])?.entity_id as string | undefined;
        const landingEntity = onPinned ? E_HOLDINGS : (ownDefault || "");
        if ((isOwner || isMulti) && landingEntity) {
          // Rewrite the response as a redirect to /studio and set fs_entity=holdings.
          const studio = NextResponse.redirect(new URL("/studio", origin));
          // Copy every cookie the auth SDK wrote onto our original response.
          for (const c of response.cookies.getAll()) {
            studio.cookies.set(c);
          }
          // cookieAttrs already carries domain/secure/sameSite from
          // authCookieOptions(host) — we spread it first, then set the
          // fs_entity specifics (path root, 1yr max-age) on top.
          studio.cookies.set({
            ...cookieAttrs,
            name: "fs_entity",
            value: landingEntity,
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
          });
          return studio;
        }
        // Task #27 (2026-09-21) — a SINGLE-house user's cookie is forced too.
        // Until now only owners/multi-membership users had fs_entity
        // rewritten on sign-in, so a shared device kept whatever house it
        // last held: Taller's cook signing in on the pass iPad landed in
        // Bistro Mondo's chrome. Their default membership wins; the profile's
        // restaurant is the fallback. (The client no longer lets a stale
        // localStorage value override this cookie — lib/ctx.)
        const single = (raw.find((m: any) => m.is_default) || raw[0])?.entity_id as string | undefined;
        let value: string | null = single && isPrimaryEntity(single) ? single : null;
        if (!value && single) value = single;   // non-pinned tenant: its own UUID
        if (!value) {
          const { data: prof } = await supabase
            .from("profiles").select("restaurant_id").eq("id", uid).maybeSingle();
          const k = prof?.restaurant_id ? RESTAURANT_TO_ENTITY[prof.restaurant_id] : null;
          value = k && isPrimaryEntity(k) ? k : null;
        }
        if (value) {
          response.cookies.set({
            ...cookieAttrs,
            name: "fs_entity",
            value,
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
          });
        }
      }
    }
  } catch { /* fall through to the default `next` redirect */ }

  return response;
}
