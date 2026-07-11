// Guest-facing allergen + dietary vocabularies. Keys stay stable (they are the
// column values in menu_items.allergens/dietary). Labels are localised.

import type { Lang } from "@/lib/i18n";

export type GuestLang = "en" | "es" | "de";

export const ALLERGEN_KEYS = [
  "gluten", "dairy", "nuts", "shellfish", "eggs", "soy",
  "celery", "mustard", "sesame", "sulphites", "lupin", "fish", "molluscs", "peanuts",
] as const;
export type AllergenKey = typeof ALLERGEN_KEYS[number];

export const DIETARY_KEYS = [
  "vegan", "vegetarian", "pescatarian", "gluten_free", "dairy_free",
] as const;
export type DietaryKey = typeof DIETARY_KEYS[number];

const ALLERGEN_LABEL: Record<AllergenKey, Record<GuestLang, string>> = {
  gluten:    { en: "Gluten",     es: "Gluten",       de: "Gluten" },
  dairy:     { en: "Dairy",      es: "Lácteos",      de: "Milch" },
  nuts:      { en: "Nuts",       es: "Frutos secos", de: "Nüsse" },
  shellfish: { en: "Shellfish",  es: "Crustáceos",   de: "Krebstiere" },
  eggs:      { en: "Eggs",       es: "Huevos",       de: "Eier" },
  soy:       { en: "Soy",        es: "Soja",         de: "Soja" },
  celery:    { en: "Celery",     es: "Apio",         de: "Sellerie" },
  mustard:   { en: "Mustard",    es: "Mostaza",      de: "Senf" },
  sesame:    { en: "Sesame",     es: "Sésamo",       de: "Sesam" },
  sulphites: { en: "Sulphites",  es: "Sulfitos",     de: "Sulfite" },
  lupin:     { en: "Lupin",      es: "Altramuces",   de: "Lupinen" },
  fish:      { en: "Fish",       es: "Pescado",      de: "Fisch" },
  molluscs:  { en: "Molluscs",   es: "Moluscos",     de: "Weichtiere" },
  peanuts:   { en: "Peanuts",    es: "Cacahuetes",   de: "Erdnüsse" },
};

const DIETARY_LABEL: Record<DietaryKey, Record<GuestLang, string>> = {
  vegan:       { en: "Vegan",         es: "Vegano",         de: "Vegan" },
  vegetarian:  { en: "Vegetarian",    es: "Vegetariano",    de: "Vegetarisch" },
  pescatarian: { en: "Pescatarian",   es: "Pescetariano",   de: "Pescetarisch" },
  gluten_free: { en: "Gluten-free",   es: "Sin gluten",     de: "Glutenfrei" },
  dairy_free:  { en: "Dairy-free",    es: "Sin lácteos",    de: "Milchfrei" },
};

export function allergenLabel(k: string, lang: GuestLang): string {
  return (ALLERGEN_LABEL as any)[k]?.[lang] || (ALLERGEN_LABEL as any)[k]?.en || k;
}
export function dietaryLabel(k: string, lang: GuestLang): string {
  return (DIETARY_LABEL as any)[k]?.[lang] || (DIETARY_LABEL as any)[k]?.en || k;
}

// Copy for the /m surface, indexed by guest-language.
export const GUEST_COPY: Record<string, Record<GuestLang, string>> = {
  "m.today":          { en: "Today's specials", es: "Sugerencias de hoy", de: "Heutige Empfehlungen" },
  "m.menu":           { en: "Menu",             es: "Carta",              de: "Karte" },
  "m.wine":           { en: "Wine",             es: "Vinos",              de: "Weine" },
  "m.bar":            { en: "Bar",              es: "Barra",              de: "Bar" },
  "m.filter.allergens": { en: "Allergens I have", es: "Alérgenos que tengo", de: "Meine Allergien" },
  "m.filter.diet":    { en: "Dietary preference", es: "Preferencia dietética", de: "Ernährungspräferenz" },
  "m.filter.clear":   { en: "Clear",            es: "Limpiar",            de: "Zurücksetzen" },
  "m.book.cta":       { en: "Book a table",     es: "Reservar mesa",      de: "Tisch reservieren" },
  "m.private.cta":    { en: "Something for a special occasion?", es: "¿Algo para una ocasión especial?", de: "Für einen besonderen Anlass?" },
  "m.empty":          { en: "Nothing on the menu yet — check back soon.", es: "Aún no hay platos publicados — vuelve pronto.", de: "Noch keine Gerichte veröffentlicht — bald wieder vorbeischauen." },
  "m.filtered.empty": { en: "No items match your filters. Adjust or clear to see everything.", es: "Ningún plato coincide con tus filtros. Ajusta o limpia para ver todo.", de: "Keine passenden Gerichte. Filter anpassen oder zurücksetzen." },
  "m.section.specials.blurb": { en: "The chef's picks tonight.", es: "Las sugerencias del chef.", de: "Die heutigen Empfehlungen." },
  "m.contains":       { en: "Contains", es: "Contiene", de: "Enthält" },
};

export function copy(key: string, lang: GuestLang): string {
  return (GUEST_COPY as any)[key]?.[lang] || (GUEST_COPY as any)[key]?.en || key;
}

// Bridge to the app-wide lib/i18n Lang (en/es only) when we need it for
// staff-facing sub-surfaces embedded in the flow.
export function toAppLang(l: GuestLang): Lang {
  return l === "de" ? "en" : l;
}
