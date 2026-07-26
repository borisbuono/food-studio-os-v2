"use client";
import { useMemo, useState } from "react";
import RecipeCard from "./RecipeCard";
import type { EntityKey } from "@/lib/entities";
import { detectCategory } from "@/lib/recipes/venue-logo";

// The 3-column recipe grid with filter chips. Client-side filtering — the
// server already sorted the list so the visually strongest cards land first.
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

const CATEGORY_LABEL: Record<string, string> = {
  fish: "Fish",
  meat: "Meat",
  rice: "Rice",
  veg: "Vegetables",
  dessert: "Dessert",
  wine: "Wine",
  drinks: "Bar & Drinks",
  default: "Other",
};

export default function RecipeList({ recipes, venue }: { recipes: Recipe[]; venue: EntityKey }) {
  const [filter, setFilter] = useState<string>("all");

  const buckets = useMemo(() => {
    const m = new Map<string, number>();
    recipes.forEach((r) => {
      const c = detectCategory(r);
      m.set(c, (m.get(c) || 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [recipes]);

  const filtered = filter === "all" ? recipes : recipes.filter((r) => detectCategory(r) === filter);

  return (
    <>
      <div className="mb-10 flex flex-wrap gap-2 border-t border-line pt-6">
        <button
          onClick={() => setFilter("all")}
          className={"border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition " + (filter === "all" ? "border-ink bg-ink text-paper" : "border-line text-clay hover:border-ink hover:text-ink")}
        >
          All · {recipes.length}
        </button>
        {buckets.map(([cat, n]) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={"border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition " + (filter === cat ? "text-paper" : "border-line text-clay hover:border-ink hover:text-ink")}
            style={filter === cat ? { background: "var(--fs-accent, #171511)", borderColor: "var(--fs-accent, #171511)" } : undefined}
          >
            {CATEGORY_LABEL[cat] || cat} · {n}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((r) => (
          <RecipeCard key={r.id} recipe={r} venue={venue} />
        ))}
      </div>
    </>
  );
}
