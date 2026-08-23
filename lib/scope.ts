// scope.ts — sidebar structure per entity scope.
//
// Phase 2 (2026-08-22): the sidebar now shows a DIFFERENT link tree for
// each entity_type, not a universal one that hides items. When Boris switches
// from Bistro Mondo (operating_venue) to BBH (holding_company), the sidebar
// re-renders with Group / Portfolio sections instead of FOH / BOH / OFFICE.
// See os_consolidation_plan_2026-08-22 memory + audit doc for the rationale.

import type { Pillar } from "@/lib/routing/pillar-map";

export type EntityType =
  | "operating_venue"
  | "holding_company"
  | "advisory_client"
  | "partner"
  | "landlord";

export type SidebarItem = { href: string; label: string; badge?: string };
export type SidebarSection = {
  // A pillar-typed key so PillarTile / PillarAccent styling stays reusable
  // for FOH/BOH/OFFICE, and an arbitrary string for the new group/portfolio
  // sections (which render with a neutral chrome).
  key: Pillar | "group" | "portfolio" | "growth" | "settings" | "client" | "partner" | "landlord";
  label: string;
  items: SidebarItem[];
};

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

// The public function the sidebar renders. Missing scope → operating venue
// (safest for an unauthenticated preview, matches the current default cookie).
export function sidebarForScope(scope: EntityType | null | undefined): SidebarSection[] {
  switch (scope) {
    case "holding_company":  return HOLDING_COMPANY;
    case "advisory_client":  return ADVISORY_CLIENT;
    case "partner":          return PARTNER;
    case "landlord":         return LANDLORD;
    case "operating_venue":
    default:                 return OPERATING_VENUE;
  }
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
