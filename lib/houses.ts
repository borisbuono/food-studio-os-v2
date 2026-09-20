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

import { E_BM, E_TALLER, ENTITY_LABEL, ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";

export type HouseSlug = "bm" | "taller";
export const HOUSE_SLUGS: HouseSlug[] = ["bm", "taller"];

// slug → EntityKey. Only operating venues have house slugs — BBH is the
// umbrella (studio-level), not a house.
export const HOUSE_SLUG_TO_ENTITY: Record<HouseSlug, EntityKey> = {
  bm:     E_BM,
  taller: E_TALLER,
};

export const ENTITY_TO_HOUSE_SLUG: Partial<Record<EntityKey, HouseSlug>> = {
  [E_BM]:     "bm",
  [E_TALLER]: "taller",
};

export function houseSlugForEntity(k: EntityKey | null | undefined): HouseSlug | null {
  if (!k) return null;
  return ENTITY_TO_HOUSE_SLUG[k] ?? null;
}

export function entityForHouseSlug(slug: string): EntityKey | null {
  if (!slug) return null;
  const s = slug.toLowerCase() as HouseSlug;
  return HOUSE_SLUG_TO_ENTITY[s] ?? null;
}

export function houseNameForSlug(slug: string): string {
  const k = entityForHouseSlug(slug);
  return k ? ENTITY_LABEL[k] : "House";
}

// Every operating house, in the order Studio renders them (BM before Taller).
export function listHouses(): Array<{ slug: HouseSlug; entity: EntityKey; name: string; rid: string | undefined }> {
  return HOUSE_SLUGS.map((slug) => {
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
