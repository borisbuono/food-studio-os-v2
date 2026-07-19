import type { EntityKey } from "@/lib/entities";

// Venue → placeholder logo path used by RecipeCoverHero when no photo is set.
// Boris can drop real logo files at these same paths to swap them in without touching code.
// The wordmark is the generic fallback for unknown venues (e.g. future advisory clients).
export const VENUE_LOGO: Record<EntityKey, string> = {
  holdings: "/brand/logos/ibiza-food-studios.svg",
  bistro_mondo: "/brand/logos/bistro-mondo.svg",
  taller: "/brand/logos/taller.svg",
  utopia: "/brand/logos/utopia.svg",
};
export const FALLBACK_LOGO = "/brand/logos/food-studios-wordmark.svg";

export function venueLogo(entity: EntityKey | null | undefined): string {
  if (!entity) return FALLBACK_LOGO;
  return VENUE_LOGO[entity] || FALLBACK_LOGO;
}

// Deterministic category → hero gradient tint, used by RecipeCoverHero and cover-generator.
// Keys line up with recipe.section / recipe.category strings the rest of the app already uses.
export type CategoryTint = {
  key: string;
  from: string;
  mid: string;
  to: string;
  ink: string; // caption + logo colour on top of the moody background
};

// Category detection is intentionally forgiving — recipes come in with mixed section names
// ("fish", "pescado", "starter", "dessert", "postre" etc). We normalise then match keywords.
export function detectCategory(recipe: any): string {
  // Prefer explicit signals — recipe.category = 'drink' or beverage_type
  // set means this is a bar/drinks recipe regardless of the free-text name.
  const cat = String(recipe?.category || "").toLowerCase();
  const bev = String(recipe?.beverage_type || "").toLowerCase();
  if (cat === "drink" || cat === "cocktail" || cat === "spirit" || cat === "bar") return "drinks";
  if (["cocktail","spirit","beer","soft","coffee_tea"].includes(bev)) return "drinks";
  const src = [recipe?.category, recipe?.section, recipe?.name].filter(Boolean).join(" ").toLowerCase();
  if (/cocktail|highball|spritz|negroni|margarita|mojito|martini|old fashioned|gin\s*tonic/.test(src)) return "drinks";
  if (/bar\s+menu|barra|coctel|c[oó]ctel|aperitiv|digestiv/.test(src)) return "drinks";
  if (/fish|pescad|seafood|marisco|sardin|salmon|tuna|atun|anchov/.test(src)) return "fish";
  if (/meat|carne|lamb|cordero|beef|pork|cerdo|chicken|pollo|duck|braise/.test(src)) return "meat";
  if (/rice|arroz|risott|paella|grain/.test(src)) return "rice";
  if (/veg|verdur|salad|ensalad|starter|entrant/.test(src)) return "veg";
  if (/dessert|postre|sweet|pastry|dulce/.test(src)) return "dessert";
  if (/wine|vino|cava/.test(src)) return "wine";
  return "default";
}

export const CATEGORY_TINT: Record<string, CategoryTint> = {
  fish:    { key: "fish",    from: "#4a5a6a", mid: "#2c3844", to: "#1a2028", ink: "#f5eddb" },
  meat:    { key: "meat",    from: "#6b3a2a", mid: "#3d1e15", to: "#1f0f08", ink: "#f2d9b8" },
  rice:    { key: "rice",    from: "#c9962e", mid: "#8a5e18", to: "#4d340a", ink: "#fff4d0" },
  veg:     { key: "veg",     from: "#5c6d3b", mid: "#3a4a26", to: "#1f2913", ink: "#e8ecd6" },
  dessert: { key: "dessert", from: "#d4b48c", mid: "#8a6e4c", to: "#3d2e1e", ink: "#faf3e3" },
  wine:    { key: "wine",    from: "#7a2a2a", mid: "#4a1414", to: "#200606", ink: "#f2ddc8" },
  // Pillars #5 — drinks/bar-specific palette (amber over burgundy) so
  // cocktails + spirits + bar-menu items get a distinct visual identity in
  // both BOH and FOH lists.
  drinks:  { key: "drinks",  from: "#E4A94B", mid: "#9A3122", to: "#3d1216", ink: "#faf3e3" },
  default: { key: "default", from: "#3a3a35", mid: "#252520", to: "#100f0c", ink: "#f2ecde" },
};

export function tintFor(category: string): CategoryTint {
  return CATEGORY_TINT[category] || CATEGORY_TINT.default;
}
