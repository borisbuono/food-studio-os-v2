// Per-venue brand identity for guest-facing surfaces (/m/[slug] and sub-pages).
//
// Guest pages are brand-forward, NOT OS chrome — this file carries the surface-
// level identity keyed off the restaurant slug (independent of the OS entity
// switcher, which is staff-facing). Each brand ships:
//   * accent color (the single --accent knob the CSS uses)
//   * wordmark, kicker + display serif classes
//   * paper background + ink text colour tokens
//
// New venues onboarding to guest QR menus register here.

export type GuestBrand = {
  slug: string;
  restaurantName: string;         // as printed on the page
  kicker: string;                 // small caps line above the wordmark
  accent: string;                 // --accent hex
  bg: string;                     // page background (paper tone per venue)
  ink: string;                    // primary text
  inkSoft: string;
  clay: string;                   // muted labels
  wordmarkClass: string;          // tailwind classes for the venue name
  displayClass: string;           // section headings on the guest page
  supportLine: string;            // small print at the foot
};

const BRANDS: Record<string, GuestBrand> = {
  "bistrot-mondo": {
    slug: "bistrot-mondo",
    restaurantName: "Bistrot Mondo",
    kicker: "Bistrot · Ibiza",
    accent: "#9A3122",
    bg: "#F4EFE6",
    ink: "#1B1512",
    inkSoft: "#3A2A22",
    clay: "#8A6E60",
    wordmarkClass: "font-serif italic font-light",
    displayClass: "font-serif italic font-light",
    supportLine: "Bistrot Mondo · Ibiza",
  },
  "ibiza-food-lab": {
    slug: "ibiza-food-lab",
    restaurantName: "Ibiza Food Studio",
    kicker: "Taller · Sa Penya",
    accent: "#3F4C28",
    bg: "#EFEEEB",
    ink: "#171511",
    inkSoft: "#3A352D",
    clay: "#7A7A75",
    wordmarkClass: "font-sans font-semibold uppercase tracking-[0.18em]",
    displayClass: "font-serif font-light",
    supportLine: "Ibiza Food Studio · Sa Penya",
  },
  "utopia": {
    slug: "utopia",
    restaurantName: "Restaurant Utopia",
    kicker: "Editorial demo",
    accent: "#0E7C86",
    bg: "#EFEEEB",
    ink: "#171511",
    inkSoft: "#3A352D",
    clay: "#7A7A75",
    wordmarkClass: "font-serif italic font-light",
    displayClass: "font-serif font-light",
    supportLine: "Utopia · a Food Studios venue",
  },
};

// Fallback used when a venue has a slug but no brand row yet — editorial-neutral.
const FALLBACK: GuestBrand = {
  slug: "",
  restaurantName: "",
  kicker: "",
  accent: "#3F4C28",
  bg: "#EFEEEB",
  ink: "#171511",
  inkSoft: "#3A352D",
  clay: "#7A7A75",
  wordmarkClass: "font-serif font-light",
  displayClass: "font-serif font-light",
  supportLine: "A Food Studios venue",
};

export function getGuestBrand(slug: string, restaurantName?: string): GuestBrand {
  const hit = BRANDS[slug];
  if (hit) return hit;
  return { ...FALLBACK, slug, restaurantName: restaurantName || FALLBACK.restaurantName };
}
