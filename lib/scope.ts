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
import { slugLooksLikeHouse, isHouseRoom } from "@/lib/houses";

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

// An href may carry the HOUSE_HREF_TOKEN ("/h/{house}/calendar"): the chrome
// substitutes the house in scope and DROPS the item when no house resolves
// (Studio, or a legacy path with no house cookie). This is how a house tree
// links to the URL-scoped /h/<slug>/** pages without a static slug.
export type SidebarItem = { href: string; label: string; badge?: string };

export const HOUSE_HREF_TOKEN = "{house}";

export function resolveHouseHref(href: string, houseSlug: string | null | undefined): string | null {
  if (!href.includes(HOUSE_HREF_TOKEN)) return href;
  if (!houseSlug) return null;
  return href.split(HOUSE_HREF_TOKEN).join(houseSlug);
}

export function itemsForHouse<T extends { href: string }>(items: T[], houseSlug: string | null | undefined): T[] {
  const out: T[] = [];
  for (const it of items) {
    const href = resolveHouseHref(it.href, houseSlug);
    if (href === null) continue;
    out.push(href === it.href ? it : { ...it, href });
  }
  return out;
}
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

// -----------------------------------------------------------------------------
// Sidebar trees — slim OS, slice 1 (2026-09-26).
//
// The room trees (Dining 11 · Kitchen 12 · Office 13), the Holding /
// Portfolio / Partner / Landlord trees and the nine-item Studio list are GONE.
// The model is lib/nav.ts: House = six verbs, Studio = five, /me = four.
// sidebarForScope() is kept as an adapter for callers that still think in
// sections — it returns ONE section holding the verbs of the tree the scope
// belongs to. DesktopSidebar / Dock / CommandK read lib/nav.ts directly.
// -----------------------------------------------------------------------------
import { HOUSE_VERBS, STUDIO_VERBS, type NavVerb } from "@/lib/nav";

function verbsToSection(key: SidebarSection["key"], label: string, verbs: NavVerb[]): SidebarSection {
  return { key, label, items: verbs.map((v) => ({ href: v.href, label: v.label })) };
}

const HOUSE_TREE: SidebarSection[]  = [verbsToSection("office", "House", HOUSE_VERBS)];
const STUDIO_TREE: SidebarSection[] = [verbsToSection("group", "Studio", STUDIO_VERBS)];

// The public function. Every house-level type (venue and the three legacy
// room shells) gets the six verbs; Studio and the holding company get the
// five Studio verbs. Advisory / partner / landlord users (none exist yet)
// get Studio until they have screens of their own (critic, open question 5).
export function sidebarForScope(scope: EntityType | null | undefined): SidebarSection[] {
  switch (scope) {
    case "holding_company":
    case "advisory_client":
    case "partner":
    case "landlord":
    case "studio":           return STUDIO_TREE;
    case "office_room":
    case "boh_room":
    case "foh_room":
    case "operating_venue":
    default:                 return HOUSE_TREE;
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
    if (slug && slugLooksLikeHouse(slug)) {
      // scopeForUrl is a pure sync function used from client + server, so
      // we can't await the DB here. A slug that LOOKS like a house is treated
      // as one for chrome / sidebar purposes; the actual page render calls
      // getHouseBySlug and redirects on miss.
      const houseSlug: HouseSlug = slug.toLowerCase();
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
  // Legacy cookie-bound paths (/develop/*, /execute/*, /administrate/*, /grow/*,
  // /files, /academy, /capture …) lift into the cookie's house. The room
  // dashboards (/boh, /foh, /office) were deleted 2026-09-26 — rooms are no
  // longer a nav level, only a URL segment under /h/<slug>/.
  if (!fallbackHouseSlug) return null;
  return { level: "house", houseSlug: fallbackHouseSlug };
}

// EntityKey (entities.id UUID) → EntityType. Utopia is intentionally absent
// (archived 2026-08-22). Refactor 2026-09-20: keys are the E_* UUID constants;
// legacy string keys ("holdings", "bistro_mondo", "taller") are gone.
import { E_HOLDINGS, E_BM, E_TALLER, E_UTOPIA, type EntityKey } from "@/lib/entities";
export const ENTITY_KEY_TO_TYPE: Record<EntityKey, EntityType> = {
  [E_HOLDINGS]: "holding_company",
  [E_BM]:       "operating_venue",
  [E_TALLER]:   "operating_venue",
  [E_UTOPIA]:   "operating_venue",
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
