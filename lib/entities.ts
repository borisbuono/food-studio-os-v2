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
