// houses.ts — the "house" concept in the three-level scope model.
//
// Push (2026-08-31, Boris walk 09:50 CET). The correct hierarchy is:
//
//   Studio (umbrella brand — legally Boris Buono Holdings SL)
//     └── House (an operating venue — Bistro Mondo, Taller Sa Penya)
//           └── Room (a functional area inside a house — Kitchen, Dining, Office)
//
// Rooms belong to a house. You cannot address "kitchen" without knowing
// WHICH house's kitchen. This module maps between the URL slug used in
// /h/<slug> routes and the entities.id UUID that identifies the entity in
// every downstream query.
//
// Refactor 2026-09-20 (branch refactor/entity-uuid): EntityKey is now the
// entities.id UUID; slug lives on entities.slug and drives URL routing.
// BBH gets the DB slug 'holdings' but does NOT get a /h/holdings route —
// Studio is /studio, not a house.
//
// P0 fix 2026-09-20 (Amsterdam rehearsal punchlist): the sync
// entityForHouseSlug() used to key on a compile-time HOUSE_SLUG_TO_ENTITY
// map that only knew "bm" and "taller", so any new tenant's slug returned
// null and every /h/<their-slug> page hard-redirected to /studio. The
// DB-driven resolvers live in `lib/houses.server.ts` (getHouseBySlug,
// getMyHouses, entityForHouseSlug). This file keeps the client-safe
// primitives — types, sync helpers, pinned maps — that get bundled into
// client components (DesktopSidebar, RoomSwitcher, ChefRoot etc). Server
// pages import BOTH: types from here, DB lookups from the .server file.

import { E_BM, E_TALLER, E_UTOPIA, ENTITY_LABEL, ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";

// HouseSlug is now `string` — any tenant with `entities.slug` set gets a
// valid /h/<slug> route. The pinned literal union it used to be ("bm" |
// "taller") stopped Amsterdam-shaped slugs at compile time.
export type HouseSlug = string;

// Pinned slugs — Boris's operating venues, used as a default listing on
// the Studio surface until getMyHouses() lands the DB-driven equivalent.
// Utopia joined 2026-09-21 as the sandbox venue (P0 unblock).
const PINNED_HOUSE_SLUGS: string[] = ["bm", "taller", "utopia"];
export const HOUSE_SLUGS: string[] = PINNED_HOUSE_SLUGS;

// Sync — pure string test used by pure functions (scope.ts::scopeForUrl) that
// can't await. Any slug-shaped string is treated as a plausible house URL;
// the actual DB validation happens when the page renders and calls
// getHouseBySlug. Invalid → the page redirects to /studio.
export function slugLooksLikeHouse(slug: string): boolean {
  if (!slug) return false;
  return /^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug);
}

// Pinned display names for the three UUIDs; the sync houseNameForSlug uses
// this before it falls back to a titlecased slug. Full DB name is available
// on `House.name` from getHouseBySlug for surfaces that can await.
const PINNED_HOUSE_NAMES: Record<string, string> = {
  bm: "Bistro Mondo",
  taller: "Taller Sa Penya",
  utopia: "Utopia",
};

// Sync — display label without hitting the DB. Kept sync because it is
// called from client components (RoomSwitcher aria-label) and from
// generateMetadata callers that are still sync. Uses the pinned name for
// bm/taller and a titlecased slug fallback for anything else.
export function houseNameForSlug(slug: string): string {
  if (!slug) return "House";
  const p = PINNED_HOUSE_NAMES[slug.toLowerCase()];
  if (p) return p;
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// The full house record — the shape every /h/<slug>/** page reads from the
// DB via getHouseBySlug (lib/houses.server.ts). Type lives here so client
// components can reference it without pulling the server module.
export type House = {
  id: string;              // entities.id (UUID)
  slug: string;            // entities.slug
  name: string;            // entities.name, or legal_name, or slug fallback
  legal_name: string | null;
  city: string | null;
  timezone: string;        // e.g. Europe/Madrid, Europe/Amsterdam
  country_code: string;    // e.g. ES, NL
  currency_code: string;   // e.g. EUR
  accent_color: string | null;
  entity_type: string;     // 'operating_venue' | 'operating' (legacy)
  restaurant_id: string | null; // linked restaurants.id, when present
};

// ---------------------------------------------------------------------------
// House-aware formatting. Every /h/<slug>/** surface must render money and
// dates in the HOUSE's currency and locale, not Ibiza's — "€" + en-GB was
// hardcoded across the house pages, so a US or UK tenant saw euro signs on
// dollar amounts (onboarding stress test 2026-09-21, polish list).

type HouseFormatBase = Pick<House, "currency_code" | "country_code"> & Partial<Pick<House, "timezone">>;

const COUNTRY_LOCALE: Record<string, string> = {
  ES: "es-ES", NL: "nl-NL", FR: "fr-FR", IT: "it-IT",
  PT: "pt-PT", DE: "de-DE", GB: "en-GB", US: "en-US",
};

export function houseLocale(house: HouseFormatBase | null | undefined): string {
  return COUNTRY_LOCALE[(house?.country_code || "ES").toUpperCase()] || "en-GB";
}

// Money in the house's own currency. `dp` defaults to 0 (tile figures);
// pass 2 where cents matter (labor cost, manual EOD).
export function houseMoney(house: HouseFormatBase | null | undefined, n: number, dp: 0 | 2 = 0): string {
  const currency = (house?.currency_code || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat(houseLocale(house), {
      style: "currency", currency,
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    }).format(n);
  } catch {
    // Unknown currency code in the DB — never crash a dashboard over it.
    return `${currency} ${n.toFixed(dp)}`;
  }
}

export function houseDateTime(
  house: HouseFormatBase | null | undefined,
  opts: Intl.DateTimeFormatOptions,
  when: Date = new Date(),
): string {
  return new Intl.DateTimeFormat(houseLocale(house), { timeZone: house?.timezone, ...opts }).format(when);
}

// ---------------------------------------------------------------------------
// Legacy pinned maps — kept for the client components that still key styling
// on the three primary UUIDs. New callers should prefer getHouseBySlug()
// from lib/houses.server.ts.
// ---------------------------------------------------------------------------

// Runtime map is BM+Taller only; TypeScript sig widened to string so widened
// HouseSlug can index without a cast at call sites.
export const HOUSE_SLUG_TO_ENTITY: Record<string, EntityKey> = {
  bm:     E_BM,
  taller: E_TALLER,
  utopia: E_UTOPIA,
};

export const ENTITY_TO_HOUSE_SLUG: Partial<Record<EntityKey, string>> = {
  [E_BM]:     "bm",
  [E_TALLER]: "taller",
  [E_UTOPIA]: "utopia",
};

export function houseSlugForEntity(k: EntityKey | null | undefined): string | null {
  if (!k) return null;
  return ENTITY_TO_HOUSE_SLUG[k] ?? null;
}

// Every pinned house (BM, Taller), in Studio render order. Client components
// use this to lay out the two-house switcher without an async fetch.
export function listHouses(): Array<{ slug: string; entity: EntityKey; name: string; rid: string | undefined }> {
  return PINNED_HOUSE_SLUGS.map((slug) => {
    const entity = HOUSE_SLUG_TO_ENTITY[slug];
    return {
      slug,
      entity,
      name: ENTITY_LABEL[entity],
      rid: ENTITY_TO_RESTAURANT[entity],
    };
  });
}

// Room vocabulary matches the memberships.ts Room union but is scoped to
// the ROOMS THAT LIVE IN A HOUSE — "studio" is not a room, it's the level
// above the house.
export type HouseRoom = "kitchen" | "dining" | "office";
export const HOUSE_ROOMS: HouseRoom[] = ["kitchen", "dining", "office"];

export const HOUSE_ROOM_LABEL: Record<HouseRoom, string> = {
  kitchen: "Kitchen",
  dining:  "Dining Room",
  office:  "Office",
};

// The legacy route each room lives on. /h/<slug>/<room> resolves to the
// same page as the legacy path — we don't rewrite URLs, we set the entity
// cookie and redirect. Keeps every existing page working.
export const HOUSE_ROOM_LEGACY_PATH: Record<HouseRoom, string> = {
  kitchen: "/boh",
  dining:  "/foh",
  office:  "/office",
};

export function isHouseRoom(x: string): x is HouseRoom {
  return x === "kitchen" || x === "dining" || x === "office";
}
