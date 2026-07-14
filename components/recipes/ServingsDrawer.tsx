"use client";
import { useState } from "react";
import Link from "next/link";
import ServingsScaler from "./ServingsScaler";

// Floating "Scale" affordance on the recipe detail page. Clicking opens a
// bottom drawer with the ServingsScaler inside. Chef-craft ergonomics: the
// FAB sits above the AssistantFab (bottom-right), matched hairline styling.
type Ing = { name: string; quantity?: string | number | null; unit?: string | null };

export default function ServingsDrawer({
  recipeId,
  recipeName,
  ingredients,
  baseCovers,
  costPerPax,
}: {
  recipeId: string;
  recipeName: string;
  ingredients: Ing[];
  baseCovers: number;
  costPerPax?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [covers, setCovers] = useState(baseCovers > 0 ? baseCovers : 4);

  return (
    <>
      <button
        aria-label="Scale servings"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-30 rounded-full border border-ink bg-paper px-5 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink shadow-[0_2px_0_0_rgba(0,0,0,0.03)] transition hover:bg-ink hover:text-paper"
      >
        Scale
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] overflow-y-auto border-t border-line bg-paper px-8 py-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-3xl">
              <div className="mb-6 flex items-baseline justify-between">
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-clay">Ingredient scaler · live recompute</p>
                  <h2 className="font-serif text-[32px] font-normal tracking-[-0.5px] text-ink">{recipeName}</h2>
                </div>
                <button onClick={() => setOpen(false)} className="font-mono text-[10px] uppercase tracking-[0.2em] text-clay hover:text-ink">Close ×</button>
              </div>
              <p className="mb-8 max-w-[68ch] font-serif italic text-[16px] text-clay">
                Change the number of covers. Ingredients and total cost recompute live.
              </p>
              <ServingsScaler
                ingredients={ingredients}
                baseCovers={baseCovers}
                costPerPax={costPerPax ?? null}
                onCoversChange={setCovers}
              />
              <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
                <Link
                  href={`/execute/cook/${recipeId}?p=${covers}`}
                  className="rounded-sm bg-ink px-5 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-paper transition hover:opacity-90"
                >
                  Cook at this size →
                </Link>
                <button onClick={() => setOpen(false)} className="rounded-sm border border-ink/30 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft transition hover:border-ink/60">
                  Back to the recipe
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
