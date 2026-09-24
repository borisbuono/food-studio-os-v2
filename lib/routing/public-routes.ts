// Public (signed-out) route prefixes — shared by AppChrome (hides the
// sidebar / top bar) and ChefRoot (hides the Chef control). One list so the
// two can't drift: before 2026-09-24 the Chef switch only excluded /apply/*, so
// a signed-out visitor on /welcome or /book/* got a Chef button that could
// only answer "I can't find that venue".
//
// /recipes/<slug> is public too (Boris ruling 2026-09-21) but keeps the
// app chrome for signed-in cooks, so it is in CHEF_HIDDEN_PREFIXES only.
export const PUBLIC_PREFIXES = [
  "/welcome",
  "/login",
  "/auth/",
  "/m/",
  "/booking-terms",
  "/onboard",
  "/apply/",
  "/book/",
];

export function isPublicRoute(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

export const CHEF_HIDDEN_PREFIXES = [...PUBLIC_PREFIXES, "/recipes/"];

export function isChefHiddenRoute(path: string): boolean {
  return CHEF_HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(p));
}

// Chromeless but AUTHENTICATED (Chef v3 P2 S5): the wall screen at the pass
// (/h/<slug>/pass) renders without sidebar / top bar, but the user must be
// signed in (the page redirects to /login otherwise) and Chef stays mounted
// — it is the whole point of the screen. So it is NOT in PUBLIC_PREFIXES
// (that would skip auth and hide Chef); AppChrome checks this instead and
// sets body[data-shell="pass"].
const CHROMELESS_RE = /^\/h\/[^/]+\/pass$/;

export function isChromelessRoute(path: string): boolean {
  return CHROMELESS_RE.test(path);
}
