import { getCoverForRecipe } from "@/lib/recipes/cover-generator";
import type { EntityKey } from "@/lib/entities";

// The moody cover that opens every recipe surface — three sizes:
//   card    — 4/5 tile on the list grid
//   spread  — the magazine spread on the detail page
//   inline  — a small badge for tight surfaces (deferred, but reserved)
//
// Placeholder chain (see lib/recipes/cover-generator.ts):
//   1. recipe.cover_photo_url → photo with legibility scrim
//   2. recipe.hero_image_url  → same, legacy field
//   3. Procedural moody category gradient + deterministic motif overlay
//      + venue logo centred + optional italic caption from recipe.tagline
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

// Deterministic motif renderer — matches lib/recipes/cover-generator.ts.
// Kept in-component so the React path and the pure-SVG path stay in sync.
function Motif({ kind, seed, color, opacity }: { kind: string; seed: number; color: string; opacity: number }) {
  const rnd = mulberry32(seed);
  const jitter = (base: number, range: number) => base + (rnd() - 0.5) * range;
  const w = 340;
  const h = 425;
  const cx = w / 2;
  const cy = h * 0.65;
  const stroke = { stroke: color, strokeOpacity: opacity, fill: "none", strokeWidth: 1.4 } as const;
  const fillDots = { fill: color, fillOpacity: opacity * 0.7 } as const;

  if (kind === "waves") {
    const y1 = jitter(cy - 8, 12), y2 = jitter(cy + 12, 12), y3 = jitter(cy + 32, 12);
    return (
      <g>
        <path {...stroke} d={`M${w * 0.1} ${y1} C ${w * 0.3} ${y1 - 12}, ${w * 0.55} ${y1 + 8}, ${w * 0.85} ${y1 - 4}`} />
        <path {...stroke} d={`M${w * 0.15} ${y2} C ${w * 0.4} ${y2 + 14}, ${w * 0.6} ${y2 - 6}, ${w * 0.9} ${y2 + 2}`} />
        <path {...stroke} d={`M${w * 0.55} ${y3} C ${w * 0.7} ${y3 - 6}, ${w * 0.85} ${y3 - 2}, ${w * 0.95} ${y3 - 6}`} />
      </g>
    );
  }
  if (kind === "shape") {
    const rx = jitter(w * 0.28, w * 0.05);
    const ry = jitter(h * 0.14, h * 0.03);
    return (
      <g>
        <ellipse {...stroke} cx={cx} cy={cy} rx={rx} ry={ry} />
        <ellipse {...stroke} cx={cx - jitter(0, 20)} cy={cy + jitter(0, 12)} rx={rx * 0.5} ry={ry * 0.5} strokeOpacity={opacity * 0.6} />
      </g>
    );
  }
  if (kind === "dots") {
    const rows = 3, cols = 6;
    const nodes = [] as JSX.Element[];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = jitter(w * (0.15 + (c / (cols - 1)) * 0.7), 8);
        const py = jitter(cy - 20 + r * 30, 6);
        const rr = 2.5 + rnd() * 2.5;
        nodes.push(<circle key={`${r}-${c}`} cx={px} cy={py} r={rr} {...fillDots} />);
      }
    }
    return <g>{nodes}</g>;
  }
  if (kind === "leaves") {
    const nodes = [] as JSX.Element[];
    for (let i = 0; i < 5; i++) {
      const x = jitter(w * (0.2 + i * 0.15), 12);
      const y = jitter(cy + (i % 2 ? 12 : -8), 10);
      nodes.push(<path key={i} {...stroke} d={`M${x} ${y} Q ${x + 14} ${y - 18}, ${x + 28} ${y - 4} Q ${x + 14} ${y + 6}, ${x} ${y} Z`} />);
    }
    return <g>{nodes}</g>;
  }
  if (kind === "grain") {
    const nodes = [] as JSX.Element[];
    for (let i = 0; i < 40; i++) {
      const px = jitter(w * 0.5, w * 0.8);
      const py = jitter(cy, h * 0.4);
      nodes.push(<circle key={i} cx={px} cy={py} r={0.5 + rnd()} {...fillDots} />);
    }
    return <g>{nodes}</g>;
  }
  return (
    <g>
      <path {...stroke} d={`M${w * 0.1} ${cy} C ${w * 0.3} ${cy - 20}, ${w * 0.7} ${cy + 20}, ${w * 0.9} ${cy - 6}`} />
    </g>
  );
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const spec = getCoverForRecipe(recipe, venue);
  const cap = caption ?? spec.caption;
  const aspect = size === "spread" ? "aspect-[4/5]" : size === "inline" ? "aspect-square" : "aspect-[4/5]";
  const capSize = size === "spread" ? "text-[13px]" : "text-[12px]";

  if (spec.kind === "photo") {
    return (
      <div className={`relative overflow-hidden ${aspect}`}>
        <img src={spec.url} alt={recipe.name ?? "Recipe"} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
        {cap ? (
          <p className={`absolute bottom-5 left-5 right-5 font-serif italic ${capSize}`} style={{ color: "#f5eddb", opacity: 0.85 }}>
            {cap}
          </p>
        ) : null}
      </div>
    );
  }

  const { tint, motif, seed, logoUrl } = spec;
  const gradId = `hg-${seed}`;
  const logoSize = size === "spread" ? "h-24 w-auto" : size === "inline" ? "h-10 w-auto" : "h-16 w-auto";
  return (
    <div
      className={`relative overflow-hidden ${aspect}`}
      style={{ background: `linear-gradient(160deg, ${tint.from} 0%, ${tint.mid} 60%, ${tint.to} 100%)` }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 340 425" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id={gradId} cx="30%" cy="30%" r="80%">
            <stop offset="0%" stopColor={tint.ink} stopOpacity="0.32" />
            <stop offset="100%" stopColor={tint.to} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="340" height="425" fill={`url(#${gradId})`} />
        <Motif kind={motif.kind} seed={seed} color={motif.color} opacity={motif.opacity} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {/* filter: brightness(0) invert(1) tints the placeholder SVGs to the cover's ink colour. */}
        <img src={logoUrl} alt="" className={`${logoSize} opacity-80`} style={{ filter: "brightness(0) invert(1)" }} />
      </div>
      {cap ? (
        <p className={`absolute bottom-5 left-5 right-5 font-serif italic ${capSize}`} style={{ color: tint.ink, opacity: 0.7 }}>
          {cap}
        </p>
      ) : null}
    </div>
  );
}
