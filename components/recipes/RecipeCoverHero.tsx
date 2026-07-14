import { detectCategory, tintFor, venueLogo } from "@/lib/recipes/venue-logo";
import type { EntityKey } from "@/lib/entities";

// The moody cover that opens every recipe surface — three sizes:
//   card    — 4/5 tile on the list grid
//   spread  — the magazine spread on the detail page
//   inline  — a small badge for tight surfaces (deferred, but reserved)
//
// If the recipe has a cover_photo_url we use the photo with a legibility gradient +
// optional italic caption. If not, we render the moody category gradient with the
// venue's logo centred over it. This is the "graceful placeholder chain" — every
// recipe has a visual identity, no soft-card fallback anywhere.
type Size = "card" | "spread" | "inline";
type Recipe = {
  id: string;
  name?: string | null;
  category?: string | null;
  section?: string | null;
  tagline?: string | null;
  cover_photo_url?: string | null;
  hero_image_url?: string | null;
};

export default function RecipeCoverHero({
  recipe,
  venue,
  size = "card",
  caption,
}: {
  recipe: Recipe;
  venue: EntityKey;
  size?: Size;
  caption?: string | null;
}) {
  const cat = detectCategory(recipe);
  const tint = tintFor(cat);
  const photo = recipe.cover_photo_url || recipe.hero_image_url || null;
  const cap = caption ?? recipe.tagline ?? null;
  const aspect = size === "spread" ? "aspect-[4/5]" : size === "inline" ? "aspect-square" : "aspect-[4/5]";
  const logo = venueLogo(venue);
  const logoSize = size === "spread" ? "h-24 w-auto" : size === "inline" ? "h-10 w-auto" : "h-16 w-auto";
  const capSize = size === "spread" ? "text-[13px]" : "text-[12px]";

  // Photo variant — cover image + linear scrim so the caption stays legible.
  if (photo) {
    return (
      <div className={`relative overflow-hidden ${aspect}`} style={{ backgroundColor: tint.to }}>
        <img src={photo} alt={recipe.name ?? "Recipe"} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
        {cap ? (
          <p className={`absolute bottom-5 left-5 right-5 font-serif italic ${capSize}`} style={{ color: tint.ink, opacity: 0.85 }}>
            {cap}
          </p>
        ) : null}
      </div>
    );
  }

  // SVG variant — moody radial gradient tinted by category + venue logo centred, optional italic caption.
  const gradId = `hg-${recipe.id || cat}`;
  return (
    <div
      className={`relative overflow-hidden ${aspect}`}
      style={{ background: `linear-gradient(160deg, ${tint.from} 0%, ${tint.mid} 60%, ${tint.to} 100%)` }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 340 425" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id={gradId} cx="30%" cy="30%" r="80%">
            <stop offset="0%" stopColor={tint.ink} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tint.to} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="340" height="425" fill={`url(#${gradId})`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <img src={logo} alt="" className={`${logoSize} opacity-80`} style={{ filter: "brightness(0) invert(1)", color: tint.ink }} />
      </div>
      {cap ? (
        <p className={`absolute bottom-5 left-5 right-5 font-serif italic ${capSize}`} style={{ color: tint.ink, opacity: 0.7 }}>
          {cap}
        </p>
      ) : null}
    </div>
  );
}
