// EntityKey — the scoping key the switcher writes into the fs_entity cookie
// and every downstream page reads back. Utopia was retired 2026-08-22 as
// part of the Phase 1 entity model migration (restaurants.is_active=false).
// Never re-introduce it as a switcher key — it's a dormant trial, not an
// operating venue.
export type EntityKey = "holdings" | "bistro_mondo" | "taller";
export const ENTITY_ORDER: EntityKey[] = ["holdings", "bistro_mondo", "taller"];
// short labels for the switcher pills
export const ENTITY_SHORT: Record<EntityKey, string> = { holdings: "Holdings", bistro_mondo: "Bistro Mondo", taller: "Taller" };
// full brand names
export const ENTITY_LABEL: Record<EntityKey, string> = { holdings: "Ibiza Food Studio", bistro_mondo: "Bistro Mondo", taller: "Taller Sa Penya" };
// per-venue typographic voice — masthead
export const ENTITY_WORDMARK: Record<EntityKey, string> = {
  holdings: "font-serif text-[17px] tracking-tight text-ink",
  bistro_mondo: "font-serif italic text-[18px] text-tomato",
  taller: "font-sans text-[13px] font-semibold uppercase tracking-[0.18em] text-ink",
};
// per-venue voice — page title
export const ENTITY_H1: Record<EntityKey, string> = {
  holdings: "font-serif text-3xl text-ink",
  bistro_mondo: "font-serif italic text-4xl text-tomato",
  taller: "font-sans text-3xl font-bold uppercase tracking-[0.05em] text-ink",
};

// per-profile signature colour (the single --accent knob)
export const ENTITY_ACCENT: Record<EntityKey, string> = {
  holdings: "#3F4C28",      // olive — operator (was ochre, Boris 2026-06-09 swap to kill Claude-orange feel)
  bistro_mondo: "#9A3122",  // tomato — folk warmth
  taller: "#2B3A45",        // slate — modernist
};

// Restaurant UUID ↔ entity key. Utopia's UUID (a0000000-…-0001) is intentionally
// absent — the trial is archived and the switcher must never route to it.
export const RESTAURANT_TO_ENTITY: Record<string, EntityKey> = {
  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259": "bistro_mondo",
  "ca83e06f-a24d-43d7-bce4-57ac341d190f": "taller",
};
export const ENTITY_TO_RESTAURANT: Partial<Record<EntityKey, string>> = {
  bistro_mondo: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  taller: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
};
