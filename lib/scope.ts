// scope.ts — sidebar structure per entity scope.
//
// Phase 2 (2026-08-22): the sidebar now shows a DIFFERENT link tree for
// each entity_type, not a universal one that hides items. When Boris switches
// from Bistro Mondo (operating_venue) to BBH (holding_company), the sidebar
// re-renders with Group / Portfolio sections instead of FOH / BOH / OFFICE.
// See os_consolidation_plan_2026-08-22 memory + audit doc for the rationale.
//
// Push (2026-08-31, Boris walk 09:50 CET): scope is now three levels —
// Studio (portfolio), House (an operating venue), Room (a functional area
// inside a house). URLs adopt /studio, /h/<slug>, /h/<slug>/<room>; legacy
// paths (/office, /boh, /foh, /administrate/*) still resolve to the right
// scope via the user's fs_entity cookie. See lib/houses.ts.

import type { Pillar } from "@/lib/routing/pillar-map";
import type { HouseSlug, HouseRoom } from "@/lib/houses";
import { entityForHouseSlug, isHouseRoom } from "@/lib/houses";

export type EntityType =
  | "operating_venue"
  | "holding_company"
  | "advisory_client"
  | "partner"
  | "landlord"
  // 2026-08-30 — URL-scoped shells. AppChrome / DesktopSidebar overrides the
  // entity-derived scope when the user is inside a room route (/studio, /office,
  // /boh, /foh) so the sidebar reflects the ROOM the user is looking at, not
  // the entity they last picked from the switcher.
  | "studio"
  | "office_room"
  | "boh_room"
  | "foh_room";

export type SidebarItem = { href: string; label: string; badge?: string };
export type SidebarSection = {
  // A pillar-typed key so PillarTile / PillarAccent styling stays reusable
  // for FOH/BOH/OFFICE, and an arbitrary string for the new group/portfolio
  // sections (which render with a neutral chrome).
  key: Pillar | "group" | "portfolio" | "growth" | "settings" | "client" | "partner" | "landlord";
  label: string;
  items: SidebarItem[];
};

// -----------------------------------------------------------------------------
// Scope object — the new three-level model.
//
// scopeForUrl() returns null for legacy paths so the caller can fall back to
// the fs_entity-derived scope. resolveScope() bakes that fallback in.
// -----------------------------------------------------------------------------

export type Scope =
  | { level: "studio" }
  | { level: "house"; houseSlug: HouseSlug }
  | { level: "room"; houseSlug: HouseSlug; room: HouseRoom };

// Operating venue (BM, Taller) — the operator's day-to-day surface.
// REMOVED vs the old universal tree: Holdings link, Reach, Commercials,
// Settings-that-belong-to-holdings, /develop/menu-engineering. Those live on
// the Holdings scope now.
const OPERATING_VENUE: SidebarSection[] = [
  {
    key: "foh",
    label: "Dining Room",
    items: [
      { href: "/foh",                    label: "Dining Room" },
      { href: "/foh/bookings",           label: "Bookings" },
      { href: "/foh/pass",               label: "The Pass" },
      { href: "/foh/menu",               label: "Menu (consumer)" },
      { href: "/foh/guests",             label: "Guest arc" },
      { href: "/foh/reviews",            label: "Reviews" },
      { href: "/foh/academy",            label: "Service academy" },
      { href: "/grow/relationships",     label: "Relationships" },
      { href: "/grow/reputation",        label: "Reputation" },
      { href: "/grow/inbox",             label: "Guest inbox" },
      { href: "/m",                      label: "Guest surface" },
    ],
  },
  {
    key: "boh",
    label: "Kitchen",
    // Consolidated 2026-08-23 (Boris walkthrough): dropped Cook mode (dead
    // link — /execute/cook is per-recipe only, no landing), collapsed the
    // Menu (BOH) / Menu develop duplicate into a single Menu entry, dropped
    // the Place-an-order / Receiving duplicate (both target /execute/orders,
    // Receiving is the operator-familiar label), and moved Kitchen academy
    // off the sidebar (low-frequency, still reachable from the dashboard).
    // Order: dashboard → daily flow (MEP) → develop (Recipes, Menu, Wine,
    // Bar, Lexicon) → ops (Receiving, Inventory, Temps, Repricing, Handover).
    items: [
      { href: "/boh",                    label: "Kitchen" },
      { href: "/boh/mep",                label: "MEP" },
      { href: "/develop/recipes",        label: "Recipes" },
      { href: "/develop/menu",           label: "Menu" },
      { href: "/develop/wine",           label: "Wine" },
      { href: "/develop/bar",            label: "Bar" },
      { href: "/develop/lexicon",        label: "Lexicon" },
      { href: "/execute/orders",         label: "Receiving" },
      { href: "/execute/inventory",      label: "Inventory" },
      { href: "/execute/temp",           label: "Temps" },
      { href: "/develop/repricing",      label: "Repricing" },
      { href: "/execute/handover",       label: "Handover" },
    ],
  },
  {
    key: "office",
    label: "Office",
    items: [
      { href: "/office",                              label: "Office" },
      { href: "/administrate/finance",                label: "Finance" },
      { href: "/administrate/finance/reconciliation", label: "Reconciliation" },
      { href: "/administrate/finance/anomalies",      label: "Anomalies" },
      { href: "/administrate/finance/scans",          label: "Scan queue" },
      { href: "/administrate/finance/eod",            label: "EOD reports" },
      { href: "/administrate/invoices",               label: "Missing invoices" },
      { href: "/administrate/suppliers",              label: "Suppliers" },
      { href: "/administrate/team",                   label: "Team" },
      { href: "/administrate/team/schedule",          label: "Schedule" },
      { href: "/administrate/events",                 label: "Events" },
      { href: "/administrate/decisions",              label: "Decisions" },
    ],
  },
];

// Holding company (BBH) — the slim group-level surface. NO operating pages
// (no cook mode, no reservations, no scan queue). The operator opens a venue
// to touch those; this scope is for group-wide oversight only.
const HOLDING_COMPANY: SidebarSection[] = [
  {
    key: "group",
    label: "Group",
    items: [
      { href: "/administrate/holdings/console",       label: "Group console" },
      { href: "/administrate/finance",                label: "Consolidated finance" },
      { href: "/administrate/holdings/intercompany",  label: "Intercompany" },
      { href: "/administrate/holdings",               label: "The Structure" },
    ],
  },
  {
    key: "portfolio",
    label: "Portfolio",
    items: [
      { href: "/administrate/portfolio",              label: "Advisory + partners + landlords" },
    ],
  },
  {
    key: "growth",
    label: "Reach",
    items: [
      { href: "/grow/reach",                          label: "Reach" },
      { href: "/grow/reach/calendar",                 label: "Reach calendar" },
      { href: "/grow/commercials",                    label: "Commercials" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { href: "/administrate/settings",               label: "Settings" },
    ],
  },
];

// Advisory client (e.g. Michael's Santa Gertrudis restaurants) — even slimmer.
// The user IS the client; the OS surfaces the small set of screens that concern
// the engagement, not the operating substrate.
const ADVISORY_CLIENT: SidebarSection[] = [
  {
    key: "client",
    label: "Advisory",
    items: [
      { href: "/administrate/advisor",                label: "Client dashboard" },
      { href: "/administrate/advisor/pnl",            label: "Project P&L" },
      { href: "/administrate/advisor/invoices",       label: "Invoices out" },
    ],
  },
];

// Partner (licencees, revenue-share operators). Mirrors the advisory shape but
// with partner-specific artefacts (the licence agreement + the running ledger).
const PARTNER: SidebarSection[] = [
  {
    key: "partner",
    label: "Partner",
    items: [
      { href: "/administrate/partner",                label: "Partner dashboard" },
      { href: "/administrate/partner/licence",        label: "Licence agreement" },
      { href: "/administrate/partner/revshare",       label: "Rev-share ledger" },
    ],
  },
];

// Landlord (e.g. Alberto for Mondo, Thyrring for Taller). Two-way relationship —
// invoices IN (the rent) and side-consulting billing OUT.
const LANDLORD: SidebarSection[] = [
  {
    key: "landlord",
    label: "Landlord",
    items: [
      { href: "/administrate/landlord",                    label: "Lease dashboard" },
      { href: "/administrate/landlord/invoices-in",        label: "Invoices in" },
      { href: "/administrate/landlord/consulting",         label: "Side-consulting billing" },
    ],
  },
];


// Studio (portfolio / executive scope). When Boris — or any owner-tier user —
// is on /studio/*, the sidebar is deliberately not an operating tree: no MEP,
// no Menu, no Recipes, no Kitchen or Dining links. Those live INSIDE a house.
// Studio is oversight: pick a house, look at the people, look at the money,
// tune the system.
const STUDIO: SidebarSection[] = [
  {
    key: "group",
    label: "Studio",
    items: [
      { href: "/studio",                              label: "Overview" },
      { href: "/administrate/holdings",               label: "Houses" },
      { href: "/administrate/team",                   label: "People" },
      { href: "/administrate/finance",                label: "Money" },
      { href: "/command",                             label: "Command" },
    ],
  },
];

// Office-room scope — when the user is on /office/*, show only the Office
// section from the operating tree. Extracted from OPERATING_VENUE so we don't
// duplicate the item list.
const OFFICE_ROOM: SidebarSection[] = [OPERATING_VENUE[2]];
const BOH_ROOM:    SidebarSection[] = [OPERATING_VENUE[1]];
const FOH_ROOM:    SidebarSection[] = [OPERATING_VENUE[0]];

// The public function the sidebar renders. Missing scope → operating venue
// (safest for an unauthenticated preview, matches the current default cookie).
export function sidebarForScope(scope: EntityType | null | undefined): SidebarSection[] {
  switch (scope) {
    case "holding_company":  return HOLDING_COMPANY;
    case "advisory_client":  return ADVISORY_CLIENT;
    case "partner":          return PARTNER;
    case "landlord":         return LANDLORD;
    case "studio":           return STUDIO;
    case "office_room":      return OFFICE_ROOM;
    case "boh_room":         return BOH_ROOM;
    case "foh_room":         return FOH_ROOM;
    case "operating_venue":
    default:                 return OPERATING_VENUE;
  }
}

// -----------------------------------------------------------------------------
// URL → Scope resolver (three-level).
//
// Returns:
//   • { level: "studio" }                                — /studio, /studio/*
//   • { level: "house", houseSlug }                      — /h/<slug>
//   • { level: "room", houseSlug, room }                 — /h/<slug>/<room>
//   • null                                                — legacy path;
//     caller falls back to the user's default entity via resolveScope().
//
// Kept as a pure function of pathname so it's callable from client + server.
// Legacy paths (/office, /boh, /foh, /administrate/*, etc.) intentionally
// don't return anything here — they're scope-less on their own; the caller
// resolves them against the fs_entity cookie.
// -----------------------------------------------------------------------------
export function scopeForUrl(pathname: string): Scope | null {
  if (!pathname) return null;

  // Studio level
  if (pathname === "/studio" || pathname.startsWith("/studio/")) {
    return { level: "studio" };
  }

  // House / room levels — /h/<slug> or /h/<slug>/<room>
  if (pathname === "/h" || pathname.startsWith("/h/")) {
    const parts = pathname.split("/").filter(Boolean); // ["h","<slug>",...]
    const slug = parts[1];
    if (slug && entityForHouseSlug(slug)) {
      const houseSlug = slug.toLowerCase() as HouseSlug;
      const roomPart = parts[2];
      if (roomPart && isHouseRoom(roomPart)) {
        return { level: "room", houseSlug, room: roomPart };
      }
      return { level: "house", houseSlug };
    }
  }

  return null;
}

// resolveScope — combine URL grammar with the user's fs_entity fallback.
// The Sidebar uses this to figure out the RIGHT scope for the chrome:
//   • /studio          → studio, no matter the cookie
//   • /h/bm            → house(bm)
//   • /h/bm/kitchen    → room(bm, kitchen)
//   • /office (BM ck)  → house(bm)  (legacy path bound to BM via cookie)
//   • /boh   (BM ck)   → room(bm, kitchen)
// When the fallback entity isn't a house (e.g. BBH), we return null and the
// caller (DesktopSidebar) falls back to the entityType-driven sidebar.
export function resolveScope(pathname: string, fallbackHouseSlug: HouseSlug | null): Scope | null {
  const s = scopeForUrl(pathname);
  if (s) return s;
  // Legacy path bindings — if the user is inside /office|/boh|/foh|/administrate/*
  // and their cookie points at a house, lift that into a room/house scope so
  // the room switcher + sidebar label say "Bistro Mondo · Kitchen" instead of
  // just "Kitchen".
  if (!fallbackHouseSlug) return null;
  if (!pathname) return { level: "house", houseSlug: fallbackHouseSlug };
  if (pathname.startsWith("/boh")) return { level: "room", houseSlug: fallbackHouseSlug, room: "kitchen" };
  if (pathname.startsWith("/foh")) return { level: "room", houseSlug: fallbackHouseSlug, room: "dining" };
  if (pathname.startsWith("/office") || pathname.startsWith("/administrate")) {
    return { level: "room", houseSlug: fallbackHouseSlug, room: "office" };
  }
  // Any other legacy path (/develop/*, /execute/*, /grow/*, /command, /files,
  // /academy, /schedule, /team, /messages, /order, /recipes, /menu, etc.) —
  // still house-bound; land on the house dashboard.
  return { level: "house", houseSlug: fallbackHouseSlug };
}

// EntityKey → EntityType. Utopia is intentionally absent (archived 2026-08-22).
// Once the switcher fully queries `entities` (Phase 3), the type comes straight
// from the row and this lookup goes away.
import type { EntityKey } from "@/lib/entities";
export const ENTITY_KEY_TO_TYPE: Record<EntityKey, EntityType> = {
  holdings:     "holding_company",
  bistro_mondo: "operating_venue",
  taller:       "operating_venue",
};

export function entityTypeFor(k: EntityKey | null | undefined): EntityType {
  if (!k) return "operating_venue";
  return ENTITY_KEY_TO_TYPE[k];
}

// -----------------------------------------------------------------------------
// Legacy shim — some callers (DesktopSidebar) still expect scopeForUrl to
// return an EntityType (or null). We deprecate the old signature but keep
// this helper alive as a compatibility export so incremental refactors don't
// have to change every call site in one push.
// -----------------------------------------------------------------------------
export function entityTypeForUrl(pathname: string): EntityType | null {
  const s = scopeForUrl(pathname);
  if (!s) return null;
  if (s.level === "studio") return "studio";
  // House / room both map back onto the operating tree in the entity-type
  // vocabulary — a house IS an operating_venue for sidebar-tree purposes.
  if (s.level === "room") {
    if (s.room === "office") return "office_room";
    if (s.room === "kitchen") return "boh_room";
    if (s.room === "dining") return "foh_room";
  }
  return "operating_venue";
}
