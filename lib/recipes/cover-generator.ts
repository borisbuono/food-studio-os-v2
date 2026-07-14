import { detectCategory, tintFor, venueLogo, type CategoryTint } from "./venue-logo";
import type { EntityKey } from "@/lib/entities";

// Cover generator — deterministic SVG covers so every recipe has an
// identity, no photo required. When a photo IS available the generator
// returns that instead. Order of precedence:
//   1. recipe.cover_photo_url — the real deal
//   2. recipe.hero_image_url  — legacy field, still honoured
//   3. Procedural moody gradient tinted by category, motif overlay by category,
//      venue logo centred, deterministic seed derived from recipe.id so every
//      render of the same recipe looks the same.
export type CoverSpec =
  | { kind: "photo"; url: string; caption: string | null }
  | { kind: "svg"; category: string; tint: CategoryTint; logoUrl: string; caption: string | null; motif: MotifSpec; seed: number };

export type MotifSpec = {
  kind: "waves" | "shape" | "dots" | "leaves" | "wash" | "grain";
  color: string;
  opacity: number;
};

// Small string-hash so a recipe id → a stable integer seed. Used to nudge
// motif placement so two "fish" recipes don't look identical.
function seedFrom(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Motif keyed by category — matches the mockup's visual language:
//   fish    → wavy horizontal lines (the market at 6am)
//   meat    → organic ellipse/blob (a shoulder, a shank)
//   rice    → dot field (grains + saffron threads)
//   veg     → leaf strokes
//   dessert → warm cream wash
//   wine    → grain (like a label on a cellar bottle)
//   default → a soft wash
const MOTIF_FOR: Record<string, MotifSpec["kind"]> = {
  fish: "waves",
  meat: "shape",
  rice: "dots",
  veg: "leaves",
  dessert: "wash",
  wine: "grain",
  default: "wash",
};

export function getCoverForRecipe(recipe: any, venue: EntityKey): CoverSpec {
  const caption = (recipe?.tagline as string | null) ?? null;
  if (recipe?.cover_photo_url) return { kind: "photo", url: recipe.cover_photo_url, caption };
  if (recipe?.hero_image_url) return { kind: "photo", url: recipe.hero_image_url, caption };

  const category = detectCategory(recipe);
  const tint = tintFor(category);
  const logoUrl = venueLogo(venue);
  const seed = seedFrom(String(recipe?.id || recipe?.name || category));
  const motif: MotifSpec = { kind: MOTIF_FOR[category] || "wash", color: tint.ink, opacity: 0.28 };

  return { kind: "svg", category, tint, logoUrl, caption, motif, seed };
}

// Pure SVG string generator — useful for OG-image endpoints, PDF exports,
// or anywhere a React component isn't available. React consumers should
// call RecipeCoverHero which renders the same visual with proper DOM nodes.
export function renderCoverSvg(recipe: any, venue: EntityKey, width = 340, height = 425): string {
  const spec = getCoverForRecipe(recipe, venue);
  if (spec.kind === "photo") {
    // Fallback: return a shell that references the photo — callers that need
    // pure SVG will typically opt into the procedural path anyway.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><image href="${spec.url}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/></svg>`;
  }
  const { tint, motif, seed, caption } = spec;
  const gradId = `g-${seed}`;
  const motifSvg = motifPath(motif.kind, seed, width, height);
  const cap = caption
    ? `<text x="30" y="${height - 30}" font-family="Fraunces, serif" font-size="12" font-style="italic" fill="${tint.ink}" fill-opacity="0.55">${escapeXml(caption)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="${gradId}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tint.from}"/>
      <stop offset="60%" stop-color="${tint.mid}"/>
      <stop offset="100%" stop-color="${tint.to}"/>
    </linearGradient>
    <radialGradient id="${gradId}-inner" cx="30%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${tint.ink}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${tint.to}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#${gradId}-bg)"/>
  <rect width="${width}" height="${height}" fill="url(#${gradId}-inner)"/>
  <g stroke="${tint.ink}" stroke-opacity="${motif.opacity}" fill="${tint.ink}" fill-opacity="${motif.opacity * 0.7}" stroke-width="1.4">${motifSvg}</g>
  ${cap}
</svg>`;
}

// Deterministic motif paths keyed by category. Positions nudged by the seed
// so no two recipes in the same category look identical.
function motifPath(kind: MotifSpec["kind"], seed: number, w: number, h: number): string {
  const rnd = mulberry32(seed);
  const jitter = (base: number, range: number) => base + (rnd() - 0.5) * range;
  const cx = w / 2;
  const cy = h * 0.65;

  switch (kind) {
    case "waves": {
      const y1 = jitter(cy - 8, 12), y2 = jitter(cy + 12, 12), y3 = jitter(cy + 32, 12);
      return `
        <path d="M${w * 0.1} ${y1} C ${w * 0.3} ${y1 - 12}, ${w * 0.55} ${y1 + 8}, ${w * 0.85} ${y1 - 4}" fill="none"/>
        <path d="M${w * 0.15} ${y2} C ${w * 0.4} ${y2 + 14}, ${w * 0.6} ${y2 - 6}, ${w * 0.9} ${y2 + 2}" fill="none"/>
        <path d="M${w * 0.55} ${y3} C ${w * 0.7} ${y3 - 6}, ${w * 0.85} ${y3 - 2}, ${w * 0.95} ${y3 - 6}" fill="none"/>`;
    }
    case "shape": {
      const rx = jitter(w * 0.28, w * 0.05);
      const ry = jitter(h * 0.14, h * 0.03);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none"/>
        <ellipse cx="${cx - jitter(0, 20)}" cy="${cy + jitter(0, 12)}" rx="${rx * 0.5}" ry="${ry * 0.5}" fill="none" stroke-opacity="0.6"/>`;
    }
    case "dots": {
      let out = "";
      const rows = 3, cols = 6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = jitter(w * (0.15 + (c / (cols - 1)) * 0.7), 8);
          const py = jitter(cy - 20 + r * 30, 6);
          const rr = 2.5 + rnd() * 2.5;
          out += `<circle cx="${px}" cy="${py}" r="${rr}" stroke="none"/>`;
        }
      }
      return out;
    }
    case "leaves": {
      let out = "";
      for (let i = 0; i < 5; i++) {
        const x = jitter(w * (0.2 + i * 0.15), 12);
        const y = jitter(cy + (i % 2 ? 12 : -8), 10);
        out += `<path d="M${x} ${y} Q ${x + 14} ${y - 18}, ${x + 28} ${y - 4} Q ${x + 14} ${y + 6}, ${x} ${y} Z" fill="none"/>`;
      }
      return out;
    }
    case "grain": {
      let out = "";
      for (let i = 0; i < 40; i++) {
        const px = jitter(w * 0.5, w * 0.8);
        const py = jitter(cy, h * 0.4);
        out += `<circle cx="${px}" cy="${py}" r="${0.5 + rnd()}" stroke="none"/>`;
      }
      return out;
    }
    case "wash":
    default:
      return `<path d="M${w * 0.1} ${cy} C ${w * 0.3} ${cy - 20}, ${w * 0.7} ${cy + 20}, ${w * 0.9} ${cy - 6}" fill="none"/>`;
  }
}

// PRNG so every render of a recipe id yields the same motif placement.
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
