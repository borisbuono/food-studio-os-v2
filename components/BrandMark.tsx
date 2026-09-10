import { EntityKey, ENTITY_WORDMARK, publicNameForEntity } from "@/lib/entities";

// The brand mark: icon PNG + wordmark text.
//
// Boris walk 2026-09-11: the mark used to render as icon-only PNG. Wordmark
// text ("Food Studios", "Bistro Mondo", "Taller Sa Penya") now sits to the
// right of the icon by default, sourced from publicNameForEntity(entity) and
// styled with the per-venue typographic voice in ENTITY_WORDMARK.
//
// `variant="icon-only"` (or legacy "mark") preserves the old icon-only render
// for tight spots. `variant="full"` still exists for the big vertical lockup
// PNGs but is no longer the default — chrome surfaces use icon + text.
//
// `tone` = the BACKGROUND the mark sits on. dark bg → white logo; light bg
// → black logo.
export default function BrandMark({
  entity,
  variant = "icon-text",
  tone = "light",
}: {
  entity: EntityKey;
  variant?: "icon-text" | "icon-only" | "mark" | "full";
  tone?: "dark" | "light";
}) {
  const color = tone === "dark" ? "white" : "black";
  const iconOnly = variant === "icon-only" || variant === "mark";

  // "full" = the pre-built vertical lockup PNG (kept for the login / welcome
  // hero surfaces that still use it). Not the default any more.
  if (variant === "full") {
    if (entity === "holdings") {
      return <img src={`/brand/ifs-full-${color}.png`} alt="Ibiza Food Studio" className="h-16 w-auto" />;
    }
    if (entity === "taller") {
      return <img src={`/brand/taller-${color}.png`} alt="Taller Sa Penya" className="h-11 w-auto" />;
    }
    if (entity === "bistro_mondo") {
      return <img src={`/brand/bm-full-${color}.png`} alt="Bistro Mondo" className="h-14 w-auto" />;
    }
    return null;
  }

  // Icon PNG for each venue. Icon-only keeps the historical heights; icon+text
  // uses a slightly smaller, uniform icon so the wordmark reads next to it.
  const iconSrc =
    entity === "holdings"     ? `/brand/ifs-mark-${color}.png` :
    entity === "taller"       ? `/brand/taller-${color}.png` :
    entity === "bistro_mondo" ? `/brand/bm-mark-${color}.png` :
    null;
  if (!iconSrc) return null;

  const iconAlt =
    entity === "holdings"     ? "Ibiza Food Studio" :
    entity === "taller"       ? "Taller Sa Penya" :
    "Bistro Mondo";

  if (iconOnly) {
    // Legacy per-venue heights preserved so existing tight mounts don't shift.
    const cls =
      entity === "holdings"     ? "h-7 w-auto" :
      entity === "taller"       ? "h-5 w-auto" :
      "h-8 w-auto";
    return <img src={iconSrc} alt={iconAlt} className={cls} />;
  }

  // Default — icon + wordmark side by side. Wordmark uses the per-venue
  // typographic voice from ENTITY_WORDMARK so each house keeps its own voice.
  const wordmark = publicNameForEntity(entity);
  // Boris walk 2026-09-11: holdings should read "Food Studios" as the
  // customer-visible wordmark, not the S.L. legal form. publicNameForEntity
  // is the right source for houses (BM, Taller) — for the umbrella we drop
  // the legal suffix here at the render surface.
  const wordmarkText = entity === "holdings" ? "Food Studios" : wordmark;
  const wordmarkClass = ENTITY_WORDMARK[entity];
  return (
    <span className="flex items-center gap-2">
      <img src={iconSrc} alt={iconAlt} className="h-6 w-auto" />
      <span className={wordmarkClass}>{wordmarkText}</span>
    </span>
  );
}
