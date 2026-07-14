"use client";
import { useState } from "react";
import IngredientTable from "./IngredientTable";

// The 6-button covers scaler that recomputes ingredients and cost live.
// Client-side rounding: pieces / cloves round to whole, grams / ml above 100
// go to whole, everything else to 1 decimal.
type Ing = { name: string; quantity?: string | number | null; unit?: string | null };

const PRESETS = [2, 4, 6, 8, 12, 24];

function scaleValue(base: number, mult: number, unit: string | null | undefined) {
  const u = (unit || "").toLowerCase();
  let val = base * mult;
  if (/^(pc|pcs|piece|pieces|clove|cloves|un|unidad|whole)/.test(u)) {
    return Math.max(1, Math.round(val));
  }
  if (val >= 100) return Math.round(val);
  return Math.round(val * 10) / 10;
}

export default function ServingsScaler({
  ingredients,
  baseCovers,
  costPerPax,
  onCoversChange,
}: {
  ingredients: Ing[];
  baseCovers: number;
  costPerPax?: number | null;
  onCoversChange?: (covers: number) => void;
}) {
  const [covers, setCovers] = useState<number>(baseCovers > 0 ? baseCovers : 4);
  const base = baseCovers > 0 ? baseCovers : 1;
  const mult = covers / base;

  const scaled: Ing[] = ingredients.map((i) => {
    const n = Number(i.quantity);
    if (isFinite(n)) return { ...i, quantity: scaleValue(n, mult, i.unit) };
    return i;
  });

  const total = costPerPax != null ? Number(costPerPax) * covers : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 border-y border-line py-6">
        <span className="min-w-[64px] font-mono text-[10px] uppercase tracking-[0.08em] text-clay">For</span>
        <div className="flex flex-1 flex-wrap gap-[2px]">
          {PRESETS.map((p) => {
            const active = p === covers;
            return (
              <button
                key={p}
                onClick={() => { setCovers(p); onCoversChange?.(p); }}
                className={"border px-5 py-3 font-mono text-[12px] tabular-nums tracking-[0.04em] transition " + (active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-clay hover:border-ink hover:text-ink")}
              >
                {p} pax
              </button>
            );
          })}
        </div>
        <span className="font-serif text-[22px] tabular-nums text-ink">
          {total != null ? `€${total.toFixed(2)}` : "—"}
          {costPerPax != null ? <em className="ml-2 font-mono text-[10px] not-italic uppercase tracking-[0.06em] text-clay">· €{Number(costPerPax).toFixed(2)}/pax</em> : null}
        </span>
      </div>

      <div className="mt-10">
        <IngredientTable items={scaled} label={`Ingredients · for ${covers}`} />
      </div>
    </div>
  );
}
