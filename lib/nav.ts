// nav.ts — the slim OS navigation model (slice 1 of the Dock redesign,
// 2026-09-26, critic note TO_BORIS_slim_os_critic_2026-09-26.md, Direction A).
//
// One model, three renderers: the desktop rail (DesktopSidebar), the phone
// dock inside the Chef band (components/nav/Dock), and ⌘K (CommandK). Every
// href here MUST resolve to a real app/**/page.tsx — scripts/verify_nav.mjs
// renders all trees and fails on a miss.
//
// Structure is FIXED (Boris ruling 1: no usage data, slim on structure):
//   House  = idle (/h/<slug>) + six verbs  Service · Menu · Supplies · Money · Team · Comms
//   Studio = Houses · Money · Team · Comms · System
//
// Labels (2026-09-26, Boris): the six verbs read as NOUNS — Service · Menu ·
// Supplies · Money · Team · Comms (ES Servicio · Carta · Compras · Caja ·
// Equipo · Comunicación). The KEYS keep the original verb words
// (serve/cook/buy/close/people/reach) — they are in data-verb attributes,
// localStorage and the Chef router, and renaming them buys nothing the chef
// can see. `label` below is the EN word; renderers call verbLabel()
// (lib/nav/labels.ts) so the rail, dock and ⌘K follow the fs_lang cookie.
//   /me    = Today · Calendar · Learn · Account
// Only the ORDER of a verb's leaves is personal — recent-first from
// localStorage (lib/nav/recent.ts); at most LEAVES_VISIBLE show before "more".
//
// Rooms (Kitchen / Dining / Office) are gone from nav. They survive only as
// data scope (prep per room, pass per kitchen) and in a few URL segments.
//
// "{house}" in an href is the HOUSE_HREF_TOKEN from lib/scope.ts: the chrome
// substitutes the house in scope and drops the item when none resolves.

import type { RouteGate } from "@/lib/access/tenantScope";

export type NavLeaf = { href: string; label: string; hint?: string; gate?: RouteGate };
export type NavVerb = {
  key: string;
  label: string;
  // The screen that IS the verb — where the verb word lands.
  href: string;
  hint?: string;
  gate?: RouteGate;
  // Leaves: nav removed, screen kept. Reached from the verb screen, ⌘K, Chef.
  leaves: NavLeaf[];
};
export type NavTreeKey = "house" | "studio" | "me";
export type NavTree = { key: NavTreeKey; verbs: NavVerb[] };

export const LEAVES_VISIBLE = 5;

const H = "/h/{house}";

// ---------------------------------------------------------------- House
export const HOUSE_VERBS: NavVerb[] = [
  {
    key: "serve", label: "Service", href: "/execute/bookings", hint: "who is coming, what is on the pass",
    gate: { room: "dining" },
    leaves: [
      { href: "/execute/pass",              label: "Pass board",     hint: "service pass mep", gate: { room: "kitchen" } },
      { href: `${H}/kitchen/prep`,          label: "Prep list",      hint: "mise en place today", gate: { room: "kitchen" } },
      { href: `${H}/kitchen/prep/templates`, label: "Prep templates", hint: "prep template weekly", gate: { room: "kitchen" } },
      { href: "/execute/pass/metrics",      label: "Pass metrics",   hint: "what left the kitchen", gate: { room: "kitchen" } },
      { href: "/execute/floor",             label: "Floor",          hint: "floor plan tables", gate: { room: "dining", feature: "foh" } },
      { href: "/grow/relationships",        label: "Guests",         hint: "crm guests relationships", gate: { room: "dining", feature: "foh" } },
      { href: "/administrate/events",       label: "Events",         hint: "private dining catering", gate: { room: "office" } },
      { href: `${H}/calendar`,              label: "Calendar",       hint: "house calendar shifts bookings prep" },
      { href: `${H}/pass`,                  label: "Wall screen",    hint: "chef wall pass screen", gate: { room: "kitchen" } },
      { href: "/m",                         label: "Guest surface",  hint: "public menu m/", gate: { room: "dining", feature: "foh" } },
    ],
  },
  {
    // Slice 2 (2026-09-26): one recipe list, one recipe page (edit + costing
    // as tabs), one costing screen. Wine / bar / lexicon are leaves.
    key: "cook", label: "Menu", href: `${H}/menu/recipes`, hint: "the recipes and the menu",
    gate: { room: "kitchen" },
    leaves: [
      { href: `${H}/menu/costing`,          label: "Costing",        hint: "menu engineering repricing price margin", gate: { room: "office" } },
      { href: "/develop/recipes/import",    label: "Import recipe",  hint: "paste url import", gate: { room: "kitchen" } },
      { href: "/develop/menu/publish",      label: "Publish menu",   hint: "publish guest menu 86", gate: { room: "kitchen" } },
      { href: "/develop/wine",              label: "Wine",           hint: "wine list bottles prices", gate: { room: "kitchen" } },
      { href: "/develop/bar",               label: "Bar",            hint: "cocktails bar list", gate: { room: "kitchen" } },
      { href: "/develop/lexicon",           label: "Lexicon",        hint: "culinary lexicon taxonomy", gate: { room: "kitchen" } },
      { href: `${H}/menu/ingredients`,      label: "Ingredients",    hint: "ingredient aliases", gate: { room: "kitchen" } },
    ],
  },
  {
    key: "buy", label: "Supplies", href: "/execute/orders", hint: "what came in, what to order",
    gate: { room: "kitchen" },
    leaves: [
      { href: "/execute/receiving",         label: "Receiving",      hint: "log a delivery", gate: { room: "kitchen" } },
      { href: "/capture",                   label: "Capture",        hint: "photograph a document", gate: { room: "kitchen" } },
      { href: "/administrate/suppliers",    label: "Suppliers",      hint: "vendors", gate: { room: "office" } },
      { href: "/execute/inventory",         label: "Inventory",      hint: "stock count", gate: { room: "kitchen" } },
      { href: "/execute/temp",              label: "Temps",          hint: "haccp temperature log", gate: { room: "kitchen" } },
      { href: "/administrate/finance/scans", label: "Scan queue",    hint: "holded scan inbox paper", gate: { room: "office" } },
      { href: "/files/inbox",               label: "Files inbox",    hint: "triage documents" },
      { href: "/administrate/invoices",     label: "Missing invoices", hint: "supplier docs stuck", gate: { room: "office" } },
    ],
  },
  {
    key: "close", label: "Money", href: `${H}/office/eod`, hint: "the till and the money",
    gate: { room: "office" },
    leaves: [
      { href: "/administrate/finance",      label: "Finance",        hint: "money dashboard", gate: { room: "office" } },
      { href: "/administrate/finance/eod",  label: "EOD reports",    hint: "end of day close cash", gate: { room: "office" } },
      { href: "/administrate/finance/reconciliation", label: "Reconciliation", hint: "bank match unmatched", gate: { room: "office" } },
      { href: "/administrate/finance/anomalies", label: "Anomalies", hint: "finance triage", gate: { room: "office" } },
      { href: "/administrate/finance/costs", label: "Costs",         hint: "costs over time", gate: { room: "office" } },
      { href: "/administrate/finance/variance", label: "Variance",   hint: "where stock went", gate: { room: "office" } },
      { href: "/administrate/finance/forecast", label: "Forecast",   hint: "forecast", gate: { room: "office" } },
      { href: "/administrate/finance/payments", label: "Payments",   hint: "are we being charged", gate: { room: "office" } },
      { href: "/administrate/finance/pos-sync", label: "POS sync",   hint: "fresto pos sync status", gate: { room: "office" } },
      { href: "/administrate/finance/integrations", label: "Integrations", hint: "substrate integrations", gate: { room: "office" } },
      { href: "/administrate/finance/setup", label: "Finance setup", hint: "onboard entities holded", gate: { room: "office" } },
    ],
  },
  {
    key: "people", label: "Team", href: "/administrate/team", hint: "who is here, who is coming",
    gate: { room: "office" },
    leaves: [
      { href: "/administrate/team/schedule", label: "Rota",          hint: "shifts schedule", gate: { room: "office" } },
      { href: `${H}/office/labor`,          label: "Labour",         hint: "clock log labour cost", gate: { room: "office" } },
      { href: `${H}/clock`,                 label: "Clock station",  hint: "clock in out punch" },
      { href: `${H}/office/hiring`,         label: "Hiring",         hint: "hr funnel candidates openings", gate: { room: "office", feature: "hiring" } },
      { href: "/academy",                   label: "Academy",        hint: "lessons training", gate: { feature: "academy" } },
      { href: "/administrate/team/invite",  label: "Invite",         hint: "invite whatsapp teammate", gate: { room: "office" } },
    ],
  },
  {
    key: "reach", label: "Comms", href: `${H}/office/inbox`, hint: "what we say, what they say back",
    gate: { room: "office" },
    leaves: [
      { href: "/grow/reach/calendar?house={house}", label: "Posting calendar", hint: "content calendar social posts", gate: { room: "office" } },
      { href: "/grow/reputation",           label: "Reviews",        hint: "ratings reviews reputation", gate: { room: "dining", feature: "foh" } },
      { href: "/grow/reach?house={house}",  label: "Accounts",       hint: "meta wix ads channels", gate: { room: "office" } },
      { href: "/grow/reach/ads",            label: "Ads",            hint: "meta ads", gate: { room: "office" } },
      { href: "/grow/commercials",          label: "Commercials",    hint: "offers deals", gate: { room: "office" } },
      { href: `${H}/office/inbox/saved`,    label: "Saved replies",  hint: "canned replies", gate: { room: "office" } },
      { href: "/grow/reputation/settings",  label: "Review platforms", hint: "connect google tripadvisor", gate: { room: "office" } },
    ],
  },
];

// ---------------------------------------------------------------- Studio
export const STUDIO_VERBS: NavVerb[] = [
  {
    key: "houses", label: "Houses", href: "/studio/houses", hint: "pick a house", gate: { room: "studio" },
    leaves: [
      { href: "/studio/advisory",           label: "Advisory",       hint: "advisory clients", gate: { room: "studio" } },
      { href: "/administrate/holdings",     label: "Structure",      hint: "entity map group", gate: { room: "studio" } },
    ],
  },
  {
    key: "money", label: "Money", href: "/studio/money", hint: "portfolio money", gate: { room: "studio" },
    leaves: [
      { href: "/studio/money/menu-margin",  label: "Menu margin",    hint: "margin across houses", gate: { room: "studio" } },
      { href: "/administrate/finance",      label: "Consolidated finance", hint: "group finance", gate: { room: "studio" } },
      { href: "/administrate/finance/setup", label: "Finance setup", hint: "onboard entities", gate: { room: "studio" } },
    ],
  },
  {
    key: "people", label: "Team", href: "/studio/people", hint: "people across houses", gate: { room: "studio" },
    leaves: [
      { href: "/administrate/team/invite",  label: "Invite",         hint: "invite teammate", gate: { room: "studio" } },
    ],
  },
  {
    key: "reach", label: "Comms", href: "/grow/reach", hint: "campaigns across houses", gate: { room: "studio" },
    leaves: [
      { href: "/grow/reach/calendar",       label: "Posting calendar", hint: "content calendar", gate: { room: "studio" } },
      { href: "/grow/reach/ads",            label: "Ads",            hint: "meta ads", gate: { room: "studio" } },
      { href: "/grow/commercials",          label: "Commercials",    hint: "offers deals", gate: { room: "studio" } },
      { href: "/studio/growth",             label: "Growth",         hint: "sales funnel leads", gate: { room: "studio" } },
    ],
  },
  {
    key: "system", label: "System", href: "/administrate/settings", hint: "the plumbing", gate: { room: "studio" },
    leaves: [
      { href: "/administrate/settings/assistant", label: "Assistant", hint: "brain config", gate: { room: "studio" } },
      { href: "/administrate/settings/assistant/audit", label: "Assistant audit", hint: "what the assistant did", gate: { room: "studio" } },
      { href: "/administrate/settings/assistant/memory", label: "Assistant memory", hint: "what the assistant knows", gate: { room: "studio" } },
      { href: "/administrate/settings/pa",  label: "PA tasks",       hint: "scheduled tasks", gate: { room: "studio" } },
      { href: "/administrate/agent-charters", label: "Agent charters", hint: "agents", gate: { room: "studio" } },
      { href: "/administrate/master-todo",  label: "Master to-do",   hint: "todo board", gate: { room: "studio" } },
      { href: "/studio/recipes/review",     label: "Recipe review",  hint: "approve recipe canon", gate: { room: "studio" } },
      { href: "/files",                     label: "Files",          hint: "docs archive" },
    ],
  },
];

// ---------------------------------------------------------------- /me
export const ME_VERBS: NavVerb[] = [
  { key: "today",    label: "Today",    href: "/me/today",    hint: "my todos and calendar rows", leaves: [] },
  { key: "calendar", label: "Calendar", href: "/me/calendar", hint: "my calendar google", leaves: [] },
  { key: "learn",    label: "Learn",    href: "/academy",     hint: "lessons training", gate: { feature: "academy" }, leaves: [] },
  {
    key: "account", label: "Account", href: "/account", hint: "profile me",
    leaves: [
      { href: "/me/booking",                label: "Booking page",   hint: "book time with me" },
      { href: "/install",                   label: "Install",        hint: "install the pwa" },
      { href: "/administrate/settings/language", label: "Language",  hint: "es en" },
    ],
  },
];

export const NAV_TREES: NavTree[] = [
  { key: "house",  verbs: HOUSE_VERBS },
  { key: "studio", verbs: STUDIO_VERBS },
  { key: "me",     verbs: ME_VERBS },
];

// Which tree a path belongs to. /me-ish paths → me; /studio/* → studio;
// everything else is house (legacy cookie-bound paths included). Pages that
// appear in both Studio and House (/administrate/finance) follow the scope
// the caller is already in — `studioScope`.
export function treeForPath(pathname: string, studioScope: boolean): NavTreeKey {
  const p = pathname || "/";
  if (p === "/account" || p === "/install" || p === "/me" || p.startsWith("/me/") || /^\/team\/[^/]+\/training/.test(p)) return "me";
  if (p === "/studio" || p.startsWith("/studio/")) return "studio";
  if (studioScope) return "studio";
  return "house";
}

export function verbsFor(tree: NavTreeKey): NavVerb[] {
  return tree === "studio" ? STUDIO_VERBS : tree === "me" ? ME_VERBS : HOUSE_VERBS;
}

const pathOf = (h: string) => h.split("?")[0];

// The verb whose screen or leaves contain this path (longest match wins).
export function activeVerb(verbs: NavVerb[], pathname: string, houseSlug: string | null): NavVerb | null {
  const sub = (h: string) => (houseSlug ? h.split("{house}").join(houseSlug) : h);
  let best: { verb: NavVerb; len: number } | null = null;
  for (const v of verbs) {
    const hrefs = [v.href, ...v.leaves.map((l) => l.href)].map((h) => pathOf(sub(h)));
    for (const h of hrefs) {
      if (h.includes("{house}")) continue;
      if (pathname === h || pathname.startsWith(h + "/")) {
        if (!best || h.length > best.len) best = { verb: v, len: h.length };
      }
    }
  }
  return best?.verb ?? null;
}

// Every navigable row, flattened and labelled "Verb · Leaf" — the ⌘K list.
// `word` picks the verb's display word (lib/nav/labels.ts verbLabel, per
// language); default is the EN label. This module stays free of i18n imports
// so scripts/verify_nav.mjs can compile and run it standalone.
export function flattenNav(tree: NavTreeKey, word: (v: NavVerb) => string = (v) => v.label): Array<NavLeaf & { verb: string }> {
  const out: Array<NavLeaf & { verb: string }> = [];
  for (const v of verbsFor(tree)) {
    const word_ = word(v);
    out.push({ href: v.href, label: word_, hint: v.hint, gate: v.gate, verb: v.key });
    for (const l of v.leaves) out.push({ ...l, label: `${word_} · ${l.label}`, verb: v.key });
  }
  return out;
}
