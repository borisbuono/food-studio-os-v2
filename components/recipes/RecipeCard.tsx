import Link from "next/link";
import RecipeCoverHero from "./RecipeCoverHero";
import { noEmoji } from "@/lib/text";
import { detectCategory } from "@/lib/recipes/venue-logo";
import type { EntityKey } from "@/lib/entities";

// The list-view card. Editorial identity: hairline top border, cover, mono
// eyebrow, Fraunces title, italic note, mono meta row with a hairline top.
// No soft card wrapper, no shadow, no rounded-2xl bg — the paper does the work.
type Recipe = {
  id: string;
  name: string;
  section?: string | null;
  category?: string | null;
  beverage_type?: string | null;
  tagline?: string | null;
  cover_photo_url?: string | null;
  hero_image_url?: string | null;
  portions?: number | null;
  cost_per_portion?: number | null;
  voice_statement?: string | null;
  time_minutes?: number | null;
};

function timeLabel(mins?: number | null) {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

export default function RecipeCard({ recipe, venue }: { recipe: Recipe; venue: EntityKey }) {
  const eyebrow = [recipe.category, recipe.section].filter(Boolean).join(" · ") || "Recipe";
  const t = timeLabel(recipe.time_minutes);
  const pax = recipe.portions && recipe.portions > 0 ? `${recipe.portions} pax` : null;
  const cpp = recipe.cost_per_portion != null ? `€${Number(recipe.cost_per_portion).toFixed(2)}/pax` : null;
  const meta = [t, pax, cpp].filter(Boolean) as string[];
  // Pillars #5 — drinks recipes carry a small amber/burgundy chip so FOH +
  // BOH lists show at a glance which cards are bar/drinks. The moody cover
  // already uses the drinks tint via detectCategory + CATEGORY_TINT.
  const isDrinks = detectCategory(recipe) === "drinks";

  return (
    <Link href={`/develop/menu/${recipe.id}`} className="block border-t border-line pt-6 transition hover:opacity-75">
      <div className="mb-5">
        <RecipeCoverHero recipe={recipe} venue={venue} size="card" />
      </div>
      <div className="mb-2 flex items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-clay">{eyebrow}</p>
        {isDrinks ? (
          <span
            className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide"
            style={{ borderColor: "#9A3122", color: "#9A3122", background: "rgba(228,169,75,0.14)" }}
            title="Bar / drinks recipe"
          >
            drinks
          </span>
        ) : null}
      </div>
      <h3 className="mb-2.5 font-serif text-[22px] font-normal leading-[1.2] tracking-[-0.3px] text-ink">{noEmoji(recipe.name)}</h3>
      {recipe.voice_statement ? (
        <p className="mb-4 font-serif italic text-[14px] leading-[1.5] text-clay">{recipe.voice_statement}</p>
      ) : null}
      {meta.length ? (
        <div className="flex gap-5 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.06em] text-clay">
          {meta.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      ) : null}
    </Link>
  );
}
