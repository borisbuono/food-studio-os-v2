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
