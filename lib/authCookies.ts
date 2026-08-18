// Shared Supabase auth cookie options.
//
// Boris 2026-08-13/16 sign-in failure root cause:
//   1. Vercel serves the app on `foodstudio.ai` AND `www.foodstudio.ai`;
//      apex 301s to www so real requests always land on www.
//   2. Safari ITP was stripping the PKCE code_verifier cookie during the
//      Google -> Supabase -> app redirect because it was set without
//      explicit Secure / SameSite=Lax attributes, so exchangeCodeForSession
//      ran without a valid verifier -> silent failure -> "Guest".
//
// Fix:
//   - Set domain=.foodstudio.ai in prod so cookies share across apex + www.
//   - Force sameSite="lax" + secure=true so Safari does not treat our own
//     auth cookies as tracker cookies.
//   - Explicit path="/".
//   - Share cookie name across browser/server/middleware.
//
// Localhost / *.vercel.app preview: no domain (host-only), so dev works.

export const AUTH_COOKIE_NAME = "sb-fs-auth";

function isProdHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return h === "foodstudio.ai" || h.endsWith(".foodstudio.ai");
}

export function authCookieOptions(host: string | null | undefined) {
  const base = {
    name: AUTH_COOKIE_NAME,
    sameSite: "lax" as const,
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    // CRITICAL: httpOnly=false so the browser client can read the session
    // cookie via document.cookie. If httpOnly is left at its default (true)
    // when the server writes the cookie in /auth/callback, the sidebar/
    // client-side supabaseBrowser.auth.getSession() sees nothing and renders
    // as Guest even though sign-in server-side succeeded. The token is a
    // JWT signed by Supabase — protecting it from client-side JS reads does
    // NOT protect it from a browser-hijack (the browser already sends it as
    // Cookie header on every request). This matches the standard Supabase
    // Next.js quickstart config.
    httpOnly: false,
  };
  if (isProdHost(host)) return { ...base, domain: ".foodstudio.ai" };
  return base;
}

export function browserAuthCookieOptions() {
  const host = typeof window !== "undefined" ? window.location.hostname : null;
  return authCookieOptions(host);
}
