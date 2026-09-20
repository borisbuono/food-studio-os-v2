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
// resolver is now DB-driven: getHouseBySlug() reads entities by slug at
// runtime and returns the full house record (id, timezone, country, etc).
// entityForHouseSlug() is an async thin wrapper around it. The compile-time
// pinned map stays for the small number of client components that still
// key styling constants on the three pinned UUIDs.

import { cache } from "react";
import { supabaseServer } from "@/lib/supabaseServer";
import { E_BM, E_TALLER, ENTITY_LABEL, ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";

// HouseSlug is now `string` — any tenant with `entities.slug` set gets a
// valid /h/<slug> route. The pinned literal union it used to be ("bm" |
// "taller") stopped Amsterdam-shaped slugs at compile time.
export type HouseSlug = string;

// Pinned slugs — Boris's two operating venues, used as a default listing on
// the Studio surface until getMyHouses() lands the DB-driven equivalent.
const PINNED_HOUSE_SLUGS: string[] = ["bm", "taller"];
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

// The full house record — the shape every /h/<slug>/** page reads.
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

// Per-request cached DB lookup. React `cache()` memoises per render pass, so
// pages that call this in the body AND in generateMetadata share one query.
export const getHouseBySlug = cache(async (slug: string): Promise<House | null> => {
  if (!slug) return null;
  const s = slug.toLowerCase();
  const sb = supabaseServer();

  const { data: e } = await sb
    .from("entities")
    .select("id, slug, name, legal_name, city, timezone, country_code, currency_code, accent_color, entity_type, status")
    .eq("slug", s)
    .in("entity_type", ["operating_venue", "operating"])
    .eq("status", "active")
    .maybeSingle();
  if (!e) return null;
  const row: any = e;

  // Restaurant row (0..1 per entity). Missing is fine — some entities are
  // POS-less at first (e.g. Amsterdam Demo before they choose a till).
  let restaurant_id: string | null = null;
  try {
    const { data: r } = await sb
      .from("restaurants")
      .select("id, is_active")
      .eq("entity_id", row.id)
      .limit(1)
      .maybeSingle();
    const rr: any = r;
    if (rr && rr.is_active !== false) restaurant_id = rr.id as string;
  } catch {
    /* is_active may not exist on very old envs — non-fatal */
  }
  if (!restaurant_id) {
    // Fall back to the pinned constant for BM/Taller — same value the DB
    // has, just avoids a second query on the hot path.
    restaurant_id = ENTITY_TO_RESTAURANT[row.id as EntityKey] ?? null;
  }

  return {
    id: row.id as string,
    slug: (row.slug as string) || s,
    name: (row.name as string) || (row.legal_name as string) || houseNameForSlug(s),
    legal_name: (row.legal_name as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    timezone: (row.timezone as string) || "Europe/Madrid",
    country_code: (row.country_code as string) || "ES",
    currency_code: (row.currency_code as string) || "EUR",
    accent_color: (row.accent_color as string | null) ?? null,
    entity_type: (row.entity_type as string) || "operating_venue",
    restaurant_id,
  };
});

// Async thin wrapper — returns entities.id for callers that only need the
// UUID (most /h/<slug>/** pages do — they pass it straight into a supabase
// query as `entity_id`).
export async function entityForHouseSlug(slug: string): Promise<string | null> {
  return (await getHouseBySlug(slug))?.id ?? null;
}

// Async — every house the given auth user is an active member of, sorted by
// slug. Used by the Studio house-switcher on the way in. Two-step query
// because memberships.person_id → team_members.auth_user_id is a two-hop.
export const getMyHouses = cache(async (user_id: string): Promise<House[]> => {
  if (!user_id) return [];
  const sb = supabaseServer();
  const { data: person } = await sb
    .from("team_members")
    .select("id")
    .eq("auth_user_id", user_id)
    .maybeSingle();
  const person_id = (person as any)?.id as string | undefined;
  if (!person_id) return [];
  const { data: m } = await sb
    .from("memberships")
    .select("entity_id")
    .eq("person_id", person_id)
    .eq("status", "active");
  const ids = Array.from(new Set((m || []).map((r: any) => r.entity_id as string)));
  if (!ids.length) return [];
  const { data: es } = await sb
    .from("entities")
    .select("id, slug, name, legal_name, city, timezone, country_code, currency_code, accent_color, entity_type, status")
    .in("id", ids)
    .in("entity_type", ["operating_venue", "operating"])
    .eq("status", "active");
  const houses: House[] = (es || []).map((e: any) => ({
    id: e.id as string,
    slug: (e.slug as string) || "",
    name: (e.name as string) || (e.legal_name as string) || houseNameForSlug(e.slug || ""),
    legal_name: (e.legal_name as string | null) ?? null,
    city: (e.city as string | null) ?? null,
    timezone: (e.timezone as string) || "Europe/Madrid",
    country_code: (e.country_code as string) || "ES",
    currency_code: (e.currency_code as string) || "EUR",
    accent_color: (e.accent_color as string | null) ?? null,
    entity_type: (e.entity_type as string) || "operating_venue",
    restaurant_id: ENTITY_TO_RESTAURANT[e.id as EntityKey] ?? null,
  }));
  return houses.sort((a, b) => a.slug.localeCompare(b.slug));
});

// ---------------------------------------------------------------------------
// Legacy pinned maps — kept for the client components that still key styling
// on the three primary UUIDs. New callers should prefer getHouseBySlug().
// ---------------------------------------------------------------------------

// Runtime map is BM+Taller only; TypeScript sig widened to string so widened
// HouseSlug can index without a cast at call sites.
export const HOUSE_SLUG_TO_ENTITY: Record<string, EntityKey> = {
  bm:     E_BM,
  taller: E_TALLER,
};

export const ENTITY_TO_HOUSE_SLUG: Partial<Record<EntityKey, string>> = {
  [E_BM]:     "bm",
  [E_TALLER]: "taller",
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
