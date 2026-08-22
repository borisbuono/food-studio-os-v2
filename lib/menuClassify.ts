// Menu classification helpers.
//
// Background (2026-08-23): the design-PDF ingest (task #38) populated
// menu_items.section with the actual menu block ('breakfast', 'wine',
// 'cocktail', 'tasting_menu' …) and menu_items.category with a much finer
// sub-classification ('tintos', 'blancos', 'hot_tasty', 'pica_pica' …).
// Legacy pages assumed the top-level split lived in category ('food' /
// 'drink'), so they rendered zero after the ingest. Rather than rewrite the
// data (the sub-category values carry real meaning), we classify by section
// here and every page that used to check `category === 'food'` now uses
// `isFood(section)`.

export const FOOD_SECTIONS = new Set<string>([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "side",
  "dessert",
  "tasting_menu",
  "specials",
]);

export const DRINK_SECTIONS = new Set<string>([
  "wine",
  "coffee_tea",
  "soft",
  "cocktail",
  "beer",
  "spirit",
]);

export const FOOD_SECTION_LIST = Array.from(FOOD_SECTIONS);
export const DRINK_SECTION_LIST = Array.from(DRINK_SECTIONS);

export function isFood(section: string | null | undefined): boolean {
  if (!section) return false;
  return FOOD_SECTIONS.has(section);
}

export function isDrink(section: string | null | undefined): boolean {
  if (!section) return false;
  return DRINK_SECTIONS.has(section);
}
