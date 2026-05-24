export type EntityKey = "holdings" | "bistro_mondo" | "taller" | "utopia";
export const ENTITY_ORDER: EntityKey[] = ["holdings", "bistro_mondo", "taller", "utopia"];
// short labels for the switcher pills
export const ENTITY_SHORT: Record<EntityKey, string> = { holdings: "Holdings", bistro_mondo: "Bistro Mondo", taller: "Taller", utopia: "Utopia" };
// full brand names
export const ENTITY_LABEL: Record<EntityKey, string> = { holdings: "Ibiza Food Studio", bistro_mondo: "Bistro Mondo", taller: "Taller Sa Penya", utopia: "Restaurant Utopia" };
// per-venue typographic voice — masthead
export const ENTITY_WORDMARK: Record<EntityKey, string> = {
  holdings: "font-serif text-[17px] tracking-tight text-ink",
  bistro_mondo: "font-serif italic text-[18px] text-tomato",
  taller: "font-sans text-[13px] font-semibold uppercase tracking-[0.18em] text-ink",
  utopia: "font-serif italic text-[17px] text-ochre",
};
// per-venue voice — page title
export const ENTITY_H1: Record<EntityKey, string> = {
  holdings: "font-serif text-3xl text-ink",
  bistro_mondo: "font-serif italic text-4xl text-tomato",
  taller: "font-sans text-3xl font-bold uppercase tracking-[0.05em] text-ink",
  utopia: "font-serif italic text-3xl text-ochre",
};

// per-profile signature colour (the single --accent knob)
export const ENTITY_ACCENT: Record<EntityKey, string> = {
  holdings: "#B5701C",      // ochre — the operator
  bistro_mondo: "#9A3122",  // tomato — folk warmth
  taller: "#2B3A45",        // slate — modernist
  utopia: "#0E7C86",        // teal-blue — the most-seen demo profile (starting option)
};
