// retired.ts — every route deleted by the slim-OS cut (slice 1, 2026-09-26)
// and where it now lands. ONE table; middleware.ts serves the redirect, and
// scripts/verify_nav.mjs asserts (a) no page.tsx exists for a retired path
// and (b) every survivor resolves to a real page.
//
// Ruling (critic note, Direction A, Boris-authorised): no users yet, so
// delete rather than deprecate — but no 404s: every retired address 308s to
// its survivor. Patterns: `:house` (a house slug), `:id`, `:room`, `:entity`
// match one segment. A survivor that needs `:house` takes it from the URL
// when present, else from the fs_entity cookie (middleware resolves the slug);
// with no house at all it lands on `/`, which picks the house.
//
// Edge-safe: pure strings, no imports.

export type Retired = { from: string; to: string; why: string };

export const RETIRED: Retired[] = [
  // ---- 33 pure-redirect stubs (the "muscle-memory" aliases) ----
  { from: "/boh/bar",                 to: "/develop/bar",                     why: "alias" },
  { from: "/boh/cook",                to: "/h/:house/menu/recipes",        why: "alias (pointed at /boh)" },
  { from: "/boh/menu",                to: "/h/:house/menu/recipes",        why: "alias" },
  { from: "/boh/mep", to: "/execute/pass",                    why: "alias" },
  { from: "/boh/receiving",           to: "/execute/orders",                  why: "alias" },
  { from: "/boh/recipes",             to: "/h/:house/menu/recipes",        why: "alias" },
  { from: "/boh/wine",                to: "/develop/wine",                    why: "alias" },
  { from: "/develop/menu-engineering", to: "/h/:house/menu/costing",          why: "alias" },
  { from: "/execute/handover", to: "/execute/pass",                    why: "alias" },
  { from: "/foh/bookings", to: "/execute/bookings",                why: "alias" },
  { from: "/foh/guests",              to: "/grow/relationships",              why: "alias" },
  { from: "/foh/menu",                to: "/h/:house/menu/recipes",        why: "alias" },
  { from: "/foh/pass", to: "/execute/pass",                    why: "alias" },
  { from: "/foh/reviews",             to: "/grow/reputation",                 why: "alias" },
  { from: "/office/advisor",          to: "/studio/advisory",                 why: "alias" },
  { from: "/office/charters",         to: "/administrate/agent-charters",     why: "alias" },
  { from: "/office/chef-log",         to: "/h/:house/office/chef-log",        why: "alias" },
  { from: "/office/finance", to: "/administrate/finance",            why: "alias" },
  { from: "/office/grow/commercials", to: "/grow/commercials",                why: "alias" },
  { from: "/office/grow/reach/ads",   to: "/grow/reach/ads",                  why: "alias" },
  { from: "/office/grow/reach",       to: "/grow/reach",                      why: "alias" },
  { from: "/office/holdings",         to: "/studio",                          why: "alias (console merged into /studio)" },
  { from: "/office/master-todo",      to: "/administrate/master-todo",        why: "alias" },
  { from: "/office/settings", to: "/administrate/settings",           why: "alias" },
  { from: "/office/suppliers", to: "/administrate/suppliers",          why: "alias" },
  { from: "/office/team", to: "/administrate/team",               why: "alias" },
  { from: "/order",                   to: "/execute/orders",                  why: "alias" },
  { from: "/recipes",                 to: "/h/:house/menu/recipes",        why: "alias (public /recipes/<slug> untouched)" },
  { from: "/recipes/:id/cook",        to: "/execute/cook/:id",                why: "alias" },
  { from: "/recipes/:id/edit",        to: "/h/:house/menu/recipes/:id?tab=edit", why: "alias" },
  { from: "/schedule",                to: "/administrate/team/schedule",      why: "alias" },
  { from: "/h/:house/office",         to: "/h/:house",                        why: "room landing (rooms left the nav)" },
  { from: "/h/:house/:room",          to: "/h/:house",                        why: "room landing (rooms left the nav)" },

  // ---- duplicate screens (critic merge/delete table, 'delete' column) ----
  // #1 see the whole group
  { from: "/studio/overview", to: "/studio", why: "dup #1" },
  { from: "/studio/command", to: "/studio", why: "dup #1" },
  { from: "/command",                         to: "/studio", why: "dup #1" },
  { from: "/administrate/holdings/console", to: "/studio", why: "dup #1" },
  // #17 run the assistant
  { from: "/administrate/holdings/console/assistant",                to: "/administrate/settings/assistant", why: "dup #17" },
  { from: "/administrate/holdings/console/assistant/usage/:entity",  to: "/administrate/settings/assistant", why: "dup #17" },
  // #2 where am I inside a house — /h/<slug> is the idle screen
  { from: "/boh",         to: "/h/:house", why: "dup #2 (room dashboard)" },
  { from: "/foh",         to: "/h/:house", why: "dup #2 (room dashboard)" },
  { from: "/office",      to: "/h/:house", why: "dup #2 (room dashboard)" },
  { from: "/execute",     to: "/h/:house", why: "dup #2 (pillar landing)" },
  { from: "/develop",     to: "/h/:house", why: "dup #2 (pillar landing)" },
  { from: "/grow",        to: "/h/:house", why: "dup #2 (pillar landing)" },
  { from: "/administrate", to: "/h/:house", why: "dup #2 (pillar landing)" },
  // #3 list every recipe → Cook
  { from: "/develop/recipes", to: "/h/:house/menu/recipes", why: "dup #3" },
  { from: "/develop/menu",    to: "/h/:house/menu/recipes", why: "dup #3" },
  { from: "/menu",            to: "/h/:house/menu/recipes", why: "dup #3" },
  // #4 open one recipe
  { from: "/develop/menu/:id", to: "/h/:house/menu/recipes/:id", why: "dup #4" },
  { from: "/menu/:id",         to: "/develop/menu/publish",         why: "dup #4 (menu-item + 86 lives on the publish grid)" },
  // #7 / #8 money
  { from: "/administrate/finance/dashboard", to: "/administrate/finance", why: "dup #7" },
  { from: "/administrate/finance/eod/new",   to: "/h/:house/office/eod",  why: "dup #8" },
  // #12 / #13 people
  { from: "/administrate/team/onboarding",   to: "/h/:house/office/hiring", why: "dup #12 (older hiring system)" },
  { from: "/administrate/team/onboard/new",  to: "/h/:house/office/hiring", why: "dup #12 (older hiring system)" },
  { from: "/administrate/team/:id/training", to: "/administrate/team/:id",  why: "dup #13 (person page links out)" },
  // #14 learn — one door
  { from: "/develop/academy", to: "/academy", why: "dup #14" },
  { from: "/boh/academy", to: "/academy", why: "dup #14" },
  { from: "/foh/academy", to: "/academy", why: "dup #14" },
  { from: "/office/academy", to: "/academy", why: "dup #14" },
  // #15 read what people wrote to us → Reach
  { from: "/grow/inbox", to: "/h/:house/office/inbox", why: "dup #15" },
  { from: "/messages",   to: "/h/:house/office/inbox", why: "dup #15 (legacy)" },
  // #16 chef log
  { from: "/administrate/chef-log", to: "/h/:house/office/chef-log", why: "dup #16" },
  // #18 advisory
  { from: "/administrate/advisor",               to: "/studio/advisory", why: "dup #18" },
  { from: "/administrate/advisor/:id",           to: "/studio/advisory", why: "dup #18" },
  { from: "/administrate/advisor/:id/checklist", to: "/studio/advisory", why: "dup #18" },

  // ---- slice 2 · Menu (2026-09-26) — one list, one recipe page, one costing screen
  { from: "/h/:house/:room/recipes",          to: "/h/:house/menu/recipes",              why: "slice 2: rooms left the URL" },
  { from: "/h/:house/:room/recipes/:id",      to: "/h/:house/menu/recipes/:id",          why: "slice 2: rooms left the URL" },
  { from: "/h/:house/:room/ingredients",      to: "/h/:house/menu/ingredients",          why: "slice 2: rooms left the URL" },
  { from: "/develop/menu/:id/edit",           to: "/h/:house/menu/recipes/:id?tab=edit", why: "dup #4: edit is a tab of the recipe page" },
  { from: "/develop/menu/:id/calculation",    to: "/h/:house/menu/recipes/:id?tab=cost", why: "dup #5: costing is a tab of the recipe page" },
  { from: "/develop/menu/engineering",        to: "/h/:house/menu/costing",              why: "dup #5: one price screen" },
  { from: "/develop/repricing",               to: "/h/:house/menu/costing?tab=repricing", why: "dup #5: one price screen" },
  { from: "/develop/wine/prices",             to: "/develop/wine?tab=prices",            why: "single: wine prices is a tab of wine" },

  // singles
  { from: "/feedback",         to: "/",              why: "feedback is a Chef intent" },
  { from: "/studio/partners",  to: "/studio/houses", why: "no partner logs in yet" },
  { from: "/studio/landlords", to: "/studio/houses", why: "no landlord logs in yet" },
];

const ROOMS = new Set(["kitchen", "dining", "office"]);

function segMatch(pat: string, seg: string, params: Record<string, string>): boolean {
  if (pat.startsWith(":")) {
    const name = pat.slice(1);
    if (name === "room" && !ROOMS.has(seg)) return false;
    if (name === "house" && !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(seg)) return false;
    // `:id` is a UUID — so /develop/menu/publish or /develop/menu/engineering
    // never fall into the /develop/menu/:id rule.
    if (name === "id" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return false;
    params[name] = seg;
    return true;
  }
  return pat === seg;
}

export type RetiredHit = { to: string; needsHouse: boolean; rule: Retired };

// Resolve a pathname against the table. `houseSlug` fills `:house` when the
// URL itself has none. Returns null when the path is not retired.
export function retiredTarget(pathname: string, houseSlug: string | null): RetiredHit | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const segs = path.split("/").filter(Boolean);
  for (const rule of RETIRED) {
    const pats = rule.from.split("/").filter(Boolean);
    if (pats.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pats.length; i++) { if (!segMatch(pats[i], segs[i], params)) { ok = false; break; } }
    if (!ok) continue;
    const needsHouse = rule.to.includes(":house") && !params.house;
    if (needsHouse && houseSlug) params.house = houseSlug;
    let to = rule.to;
    for (const [k, v] of Object.entries(params)) to = to.split(":" + k).join(v);
    if (to.includes(":house")) to = "/"; // no house anywhere → home picks one
    return { to, needsHouse, rule };
  }
  return null;
}
