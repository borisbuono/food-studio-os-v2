// -----------------------------------------------------------------------------
// Content-Security-Policy — S5(a), 2026-10-03
// -----------------------------------------------------------------------------
// Boris's ruling on the S5 open decision: CSP now, the HttpOnly refactor later
// (it would put 46 RLS-scoped browser-client components behind route handlers —
// a lane, not a slice). So the session cookie stays readable by JavaScript on
// purpose, and this header is what stands between an injected script and the
// token leaving the browser.
//
// That shapes the policy. The directives that BLOCK EXFILTRATION are enforced
// today, because they cost nothing: the browser in this app only ever talks to
// itself and to Supabase. Every third-party call — Anthropic, Holded, Google,
// Fresto, Resend, Wix, TheFork, Apideck — is made server-side from a route
// handler, verified 2026-10-03 (`grep 'fetch("https://' app components` returns
// nothing). A stolen token therefore has nowhere to go: connect-src, img-src and
// form-action are the three ways out and all three are closed.
//
// `script-src` still carries 'unsafe-inline', because Next 14 injects its
// bootstrap and flight-data scripts inline and nothing hands them a nonce yet.
// That is the remaining gap and it is deliberate, not an oversight: the second
// header below is the SAME policy with 'unsafe-inline' removed, sent
// Report-Only, so we collect the exact list of inline scripts that would break.
// That list is the input to the nonce pass. Flipping it to enforced is then one
// line, with evidence instead of a guess.
//
// Nothing here can take the OS down mid-service, which is the point.
// -----------------------------------------------------------------------------

/** The Supabase project origin the browser is allowed to reach. */
function supabaseOrigins() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    const u = new URL(raw);
    return { https: u.origin, wss: `wss://${u.host}` };
  } catch {
    // No env at header-build time (a local `next build` without .env). Fall back
    // to the project family rather than emitting a policy that breaks sign-in.
    return { https: "https://*.supabase.co", wss: "wss://*.supabase.co" };
  }
}

/**
 * @param {{ strictScripts?: boolean, frameAncestorsNone?: boolean }} [opts]
 *   strictScripts removes 'unsafe-inline' from script-src/style-src — that is
 *   the Report-Only twin, whose reports tell us what a nonce has to cover.
 *   frameAncestorsNone adds the clickjacking guard; see the note at the bottom
 *   of this file for why it is per-path and not global.
 * @returns {string}
 */
export function contentSecurityPolicy(opts = {}) {
  const { https: supa, wss: supaWss } = supabaseOrigins();
  const dev = process.env.NODE_ENV !== "production";

  // `next dev` compiles with eval; production does not. Without this, running
  // the dev server locally would be blocked by our own header.
  const scriptSrc = [
    "'self'",
    ...(opts.strictScripts ? [] : ["'unsafe-inline'"]),
    ...(dev ? ["'unsafe-eval'"] : []),
  ];

  // Google Fonts is loaded as a stylesheet: @import in app/globals.css, and a
  // <link> on the public /apply/<house> page (brand fonts per house).
  const styleSrc = [
    "'self'",
    ...(opts.strictScripts ? [] : ["'unsafe-inline'"]),
    "https://fonts.googleapis.com",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    // blob: — capture station thumbnails, Receiving and WinePrices previews.
    `img-src 'self' data: blob: ${supa}`,
    // blob: — the Chef drawer plays /api/chef/say audio from an object URL.
    "media-src 'self' blob:",
    // The only two origins the browser is allowed to open a connection to.
    `connect-src 'self' ${supa} ${supaWss}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // A form can only post back to us — an injected form cannot ship the
    // session anywhere, and the Google OAuth round-trip is a navigation, not a
    // form post, so sign-in is unaffected.
    "form-action 'self'",
    "frame-src 'none'",
    ...(opts.frameAncestorsNone ? ["frame-ancestors 'none'"] : []),
    "upgrade-insecure-requests",
    "report-to csp",
    "report-uri /api/csp-report",
  ].join("; ");
}

// -----------------------------------------------------------------------------
// Why frame-ancestors is per-path and not simply global
// -----------------------------------------------------------------------------
// The authenticated app and the sign-in pages get `frame-ancestors 'none'` —
// framing a login page is the textbook clickjack and nothing here is meant to
// be embedded.
//
// The guest-facing pages are deliberately left out: /m/<slug>/*, /book/*,
// /apply/*, /leads/capture, /legal/*, /recipes/<slug>. Those are linked from
// bistro-mondo.com and ibzfoodstudio.com and may be EMBEDDED there — nobody has
// checked the Wix sites, and breaking a live booking or job-application embed
// mid-season to close a theoretical hole is the wrong trade. Leaving them
// frameable is the reversible choice.
//
// To tighten them, one fact is needed: what actually embeds them. Then this
// becomes `frame-ancestors` with that list instead of 'none'. See
// docs/systems/auth.md.
//
// They are two separate, NON-OVERLAPPING header rules in next.config.mjs rather
// than one global policy plus a second frame-ancestors-only header: two CSP
// headers on one response are intersected by browsers, but Next's own
// header-merging for a repeated key is not something to bet the sign-in page
// on. One complete policy per path, and the emitted headers are asserted in
// scripts/test_csp_headers.sh.
// -----------------------------------------------------------------------------

/** The path prefixes that stay frameable — guest-facing, possibly Wix-embedded. */
export const GUEST_FRAMEABLE_PREFIXES = ["m", "book", "apply", "leads", "legal", "recipes"];
