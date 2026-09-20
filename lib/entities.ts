// entities.ts — canonical entity identity + display metadata.
//
// Refactor 2026-09-20 (branch refactor/entity-uuid): EntityKey is now the
// entities.id UUID, not a string enum. Slug lives on the row and drives URL
// routing (/h/bm, /h/taller) plus the fs_entity cookie; display strings
// (short label, full name, accent colour, wordmark/H1 typography) come from
// the DB seed for the primary three entities and are pinned as constants
// here for the parts of the OS that render synchronously (SSR paint, cookie
// resolvers) and can't wait on a query.
//
// Why constants at all? Every SSR paint has to resolve accent + label BEFORE
// the first byte flushes (Boris day-10 guest-flicker regression, #418/#423).
// A DB round-trip on every request would burn 40-80ms per page. Instead, the
// three primary entities are pinned; a fourth entity (e.g. Amsterdam venue)
// starts as a DB lookup only and joins the pinned set when it goes live.
//
// Utopia was retired 2026-08-22 (Phase 1 entity migration, restaurants row
// is_active=false). It intentionally has no UUID constant and no entry in
// any of the display maps — the switcher must never route to it.

// --- Canonical UUIDs (entities.id in the DB) --------------------------------
export const E_HOLDINGS = "d1ee19b6-5fb4-460c-8326-685dc86e47df" as const;
export const E_BM       = "387f1045-0340-4029-a1e4-28b15c372680" as const;
export const E_TALLER   = "daec58d9-44a2-4c24-9183-2a87219093fb" as const;

// EntityKey is the entities.id UUID — a stable primary key, not a string enum.
// Callers that need to name a specific entity import the E_* constants above.
export type EntityKey = typeof E_HOLDINGS | typeof E_BM | typeof E_TALLER;

export const ENTITY_ORDER: EntityKey[] = [E_HOLDINGS, E_BM, E_TALLER];

// True when the value is one of the three pinned primary entities. Guards
// cookie parsing + fallbacks — see serverVenue.ts. UUIDs from other entities
// (advisory clients, landlords, partners) exist in the DB but don't render as
// house/venue switcher pills.
export function isPrimaryEntity(x: string | null | undefined): x is EntityKey {
  return x === E_HOLDINGS || x === E_BM || x === E_TALLER;
}

// short labels for the switcher pills
export const ENTITY_SHORT: Record<EntityKey, string> = {
  [E_HOLDINGS]: "Holdings",
  [E_BM]:       "Bistro Mondo",
  [E_TALLER]:   "Taller",
};

// full brand names (the internal shorthand — see publicNameForEntity for the
// customer-facing rendering)
export const ENTITY_LABEL: Record<EntityKey, string> = {
  [E_HOLDINGS]: "Ibiza Food Studio",
  [E_BM]:       "Bistro Mondo",
  [E_TALLER]:   "Taller Sa Penya",
};

// Public trading name — used at ANY customer-facing render surface.
// The DB `entities.name` field is the internal shorthand (BBH, Bistro Mondo,
// Taller Sa Penya / "IFL" etc.); this helper maps it to the name we show
// externally. Boris walk 2026-09-10: BBH is never spelled out to guests or
// partners; the S.L. legal form is the trading name for the holding.
//
// Accepts either the entities.id UUID (preferred) or a historical string
// alias (bbh, ifl, taller, mondo) so old data pulled from CSV imports still
// resolves. Unknown inputs are echoed back verbatim so we don't paper over
// new houses.
export function publicNameForEntity(entity: EntityKey | string | null | undefined): string {
  const raw = (entity || "").toString();
  if (raw === E_HOLDINGS) return "Ibiza Food Studio S.L.";
  if (raw === E_BM)       return "Bistro Mondo";
  if (raw === E_TALLER)   return "Taller Sa Penya";
  const e = raw.toLowerCase();
  if (e === "holdings" || e === "bbh" || e === "boris buono holdings" || e === "boris buono holdings sl") return "Ibiza Food Studio S.L.";
  if (e === "bistro_mondo" || e === "bm" || e === "bistro mondo" || e === "bistrot mondo") return "Bistro Mondo";
  if (e === "taller" || e === "ifl" || e === "taller sa penya" || e === "ibiza food lab" || e === "ibiza food studios") return "Taller Sa Penya";
  return String(entity ?? "");
}

// per-venue typographic voice — masthead
export const ENTITY_WORDMARK: Record<EntityKey, string> = {
  [E_HOLDINGS]: "font-serif text-[17px] tracking-tight text-ink",
  [E_BM]:       "font-serif italic text-[18px] text-tomato",
  [E_TALLER]:   "font-sans text-[13px] font-semibold uppercase tracking-[0.18em] text-ink",
};

// per-venue voice — page title
export const ENTITY_H1: Record<EntityKey, string> = {
  [E_HOLDINGS]: "font-serif text-3xl text-ink",
  [E_BM]:       "font-serif italic text-4xl text-tomato",
  [E_TALLER]:   "font-sans text-3xl font-bold uppercase tracking-[0.05em] text-ink",
};

// per-profile signature colour (the single --accent knob). Mirrors
// entities.accent_color in the DB — kept in sync by the migration seed.
export const ENTITY_ACCENT: Record<EntityKey, string> = {
  [E_HOLDINGS]: "#3F4C28",      // olive — operator
  [E_BM]:       "#9A3122",      // tomato — folk warmth
  [E_TALLER]:   "#2B3A45",      // slate — modernist
};

// Restaurant UUID ↔ entity UUID. `restaurants.id` is the older per-venue key
// that profiles.restaurant_id and every EOD/POS write path still uses; the
// FK `restaurants.entity_id` binds each restaurant to exactly one entity.
// Holdings has no restaurant row — it's a group-level scope, not a venue.
// Utopia's restaurant UUID (a0000000-…-0001) is intentionally absent —
// the trial is archived (restaurants.is_active=false) and the switcher must
// never route to it.
export const RESTAURANT_TO_ENTITY: Record<string, EntityKey> = {
  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259": E_BM,
  "ca83e06f-a24d-43d7-bce4-57ac341d190f": E_TALLER,
};
export const ENTITY_TO_RESTAURANT: Partial<Record<EntityKey, string>> = {
  [E_BM]:     "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  [E_TALLER]: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
};
