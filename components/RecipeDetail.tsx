"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// Recipe detail — editable header + ingredients + method + explode-to-prep.
// Same visual language as PrepList. Not fancy; every action is one tap.

type Recipe = {
  id: string;
  entity_id: string;
  name: string;
  station: string | null;
  category: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  portion_size: number | null;
  portion_unit: string | null;
  cover_multiplier: number | null;
  sell_price_eur: number | null;
  method: string | null;
  notes: string | null;
  linked_menu_item_id: string | null;
  is_active: boolean;
  cost_per_portion_eur?: number | null;
  cost_computed_at?: string | null;
  cost_confidence?: "high" | "medium" | "low" | "missing" | null;
  // Shared recipes (2026-09-21): a mirror's content lives on its origin.
  origin_recipe_id?: string | null;
  is_public?: boolean | null;
  public_slug?: string | null;
  metadata?: Record<string, any> | null;
};

type CostBreakdown = {
  cost_per_portion_eur: number | null;
  confidence: "high" | "medium" | "low" | "missing";
  yield_qty: number;
  total_recipe_cost_eur: number;
  ingredient_count: number;
  priced_count: number;
  missing_ingredients: string[];
  breakdown: Array<{
    ingredient_name: string;
    quantity: number | null;
    unit: string | null;
    canonical_name: string | null;
    unit_price_eur: number | null;
    unit_conversion: number;
    line_cost_eur: number | null;
    price_sample_count: number;
    status: "priced" | "unpriced" | "no_alias";
    note?: string;
  }>;
};

type Ingredient = {
  id?: string;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  linked_recipe_id?: string | null;
  notes?: string | null;
  sort_order?: number;
  is_optional?: boolean;
};

function madridTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

export default function RecipeDetail({
  entityId, houseSlug, recipeId,
}: { entityId: string; houseSlug: string; recipeId: string }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ings, setIngs] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [explodeDate, setExplodeDate] = useState<string>(tomorrowISO());
  const [explodeCovers, setExplodeCovers] = useState<string>("");
  const [explodeMsg, setExplodeMsg] = useState<string | null>(null);
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costMsg, setCostMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setRecipe(j.recipe);
      setIngs((j.ingredients || []).map((i: any) => ({
        id:               i.id,
        ingredient_name:  i.ingredient_name ?? i.name ?? "",
        quantity:         i.quantity,
        unit:             i.unit,
        linked_recipe_id: i.linked_recipe_id,
        notes:            i.notes,
        sort_order:       i.sort_order ?? 0,
        is_optional:      !!i.is_optional,
      })));
      setDirty(false);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => { reload(); }, [reload]);

  const loadCost = useCallback(async () => {
    setCostLoading(true);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/cost-breakdown`, { cache: "no-store" });
      const j = await res.json();
      if (j?.ok) setCost(j as CostBreakdown);
    } catch {} finally {
      setCostLoading(false);
    }
  }, [recipeId]);

  useEffect(() => { loadCost(); }, [loadCost]);

  const recomputeCost = useCallback(async () => {
    setCostLoading(true); setCostMsg(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/compute-cost`, { method: "POST" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "recompute failed");
      setCostMsg(`Recomputed · ${j.confidence} · €${(j.cost_per_portion_eur ?? 0).toFixed(2)}/portion`);
      await loadCost();
      await reload();
    } catch (e: any) {
      setCostMsg(String(e?.message || e));
    } finally {
      setCostLoading(false);
    }
  }, [recipeId, loadCost, reload]);

  const setR = (patch: Partial<Recipe>) => {
    setRecipe((r) => r ? { ...r, ...patch } : r);
    setDirty(true);
  };
  const setIng = (idx: number, patch: Partial<Ingredient>) => {
    setIngs((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const addIng = () => {
    setIngs((xs) => [...xs, { ingredient_name: "", quantity: null, unit: null, sort_order: xs.length }]);
    setDirty(true);
  };
  const removeIng = (idx: number) => {
    setIngs((xs) => xs.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!recipe) return;
    setSaving(true); setError(null);
    try {
      const venueOnly = !!recipe.origin_recipe_id;
      const res = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(venueOnly ? {
          // Mirror: only this venue's own fields. Content is edited on the origin.
          station: recipe.station,
          cover_multiplier: recipe.cover_multiplier,
          sell_price_eur: recipe.sell_price_eur,
          linked_menu_item_id: recipe.linked_menu_item_id,
        } : {
          name: recipe.name,
          station: recipe.station,
          category: recipe.category,
          yield_qty: recipe.yield_qty,
          yield_unit: recipe.yield_unit,
          portion_size: recipe.portion_size,
          portion_unit: recipe.portion_unit,
          cover_multiplier: recipe.cover_multiplier,
          sell_price_eur: recipe.sell_price_eur,
          method: recipe.method,
          notes: recipe.notes,
          linked_menu_item_id: recipe.linked_menu_item_id,
          ingredients: ings.filter((i) => i.ingredient_name?.trim()).map((i, idx) => ({
            ingredient_name:  i.ingredient_name.trim(),
            quantity:         i.quantity,
            unit:             i.unit,
            linked_recipe_id: i.linked_recipe_id,
            notes:            i.notes,
            sort_order:       idx,
            is_optional:      !!i.is_optional,
          })),
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "save failed");
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }, [recipe, ings, recipeId, reload]);

  const softDelete = useCallback(async () => {
    if (!confirm("Retire this recipe? It will be hidden from the list.")) return;
    const res = await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
    const j = await res.json();
    if (!j?.ok) { setError(j?.error || "delete failed"); return; }
    window.location.href = `/h/${houseSlug}/kitchen/recipes`;
  }, [recipeId, houseSlug]);

  const explode = useCallback(async () => {
    setExplodeMsg(null); setError(null);
    try {
      const covers = Number(explodeCovers);
      const res = await fetch(`/api/recipes/${recipeId}/explode-to-prep`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          service_date: explodeDate,
          target_covers: Number.isFinite(covers) && covers > 0 ? covers : null,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "explode failed");
      setExplodeMsg(`Wrote ${j.inserted} prep row${j.inserted === 1 ? "" : "s"} for ${explodeDate}${j.skipped ? ` · skipped ${j.skipped} duplicate` : ""}.`);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [entityId, recipeId, explodeDate, explodeCovers]);

  if (loading) {
    return <main className="min-h-screen bg-white p-6 font-serif italic text-ink-soft">Loading…</main>;
  }
  if (!recipe) {
    return (
      <main className="min-h-screen bg-white p-6">
        <p className="font-serif italic text-ink-soft">Recipe not found.</p>
        <Link href={`/h/${houseSlug}/kitchen/recipes`} className="mt-4 inline-block font-mono text-[11px] uppercase tracking-wide underline">
          Back to recipes
        </Link>
      </main>
    );
  }

  const isMirror = !!recipe.origin_recipe_id;
  const isOrigin = !isMirror && recipe.entity_id !== entityId;

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
              {houseSlug.toUpperCase()} · Kitchen · Recipe
            </p>
            <input
              value={recipe.name}
              readOnly={isMirror}
              onChange={(e) => setR({ name: e.target.value })}
              className="mt-0.5 w-full bg-transparent font-serif text-xl leading-tight focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/h/${houseSlug}/kitchen/recipes`}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              Back
            </Link>
            <button
              onClick={save} disabled={saving || !dirty}
              className={
                "rounded-md px-3 py-2 text-[12px] font-mono uppercase tracking-wide " +
                (dirty ? "bg-ink text-white hover:opacity-90" : "border border-line text-ink-soft cursor-not-allowed")
              }
            >
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">
          {error}
        </div>
      ) : null}

      {isMirror ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-black/5 px-3 py-2 text-[12px]">
          <span>🔗 Shared recipe — mirrored from the Food Studio library. Name, ingredients and method are read-only here; station and price stay yours.</span>
          <Link href={`/h/${houseSlug}/kitchen/recipes/${recipe.origin_recipe_id}`} className="font-mono text-[11px] uppercase tracking-wide underline">
            Edit origin →
          </Link>
        </div>
      ) : isOrigin ? (
        <div className="mx-4 mt-3 rounded-md border border-line bg-black/5 px-3 py-2 text-[12px]">
          ✏️ Editing the origin. Saved changes reach every kitchen that shares this recipe.
          {recipe.is_public && recipe.public_slug ? (
            <> · 🌐 Public at <a className="underline" href={`/recipes/${recipe.public_slug}`} target="_blank" rel="noreferrer">/recipes/{recipe.public_slug}</a></>
          ) : recipe.metadata?.needs_boris_review ? <> · awaiting review</> : null}
        </div>
      ) : null}

      <section className="px-4 pb-24 pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Station">
            <input value={recipe.station ?? ""} onChange={(e) => setR({ station: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Category">
            <select value={recipe.category ?? ""} disabled={isMirror} onChange={(e) => setR({ category: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm">
              {Array.from(new Set(["", "starter", "main", "dessert", "side", "sauce", "stock", "component", ...(recipe.category ? [recipe.category] : [])])).map((c) => (
                <option key={c || "none"} value={c}>{c || "—"}</option>
              ))}
            </select>
          </Field>
          <Field label="Yield qty">
            <input inputMode="decimal" value={recipe.yield_qty ?? ""} disabled={isMirror} onChange={(e) => setR({ yield_qty: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Yield unit">
            <input value={recipe.yield_unit ?? ""} disabled={isMirror} onChange={(e) => setR({ yield_unit: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Portion size">
            <input inputMode="decimal" value={recipe.portion_size ?? ""} disabled={isMirror} onChange={(e) => setR({ portion_size: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Portion unit">
            <input value={recipe.portion_unit ?? ""} disabled={isMirror} onChange={(e) => setR({ portion_unit: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Cover multiplier">
            <input inputMode="decimal" value={recipe.cover_multiplier ?? ""} onChange={(e) => setR({ cover_multiplier: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Sell price €">
            <input inputMode="decimal" value={recipe.sell_price_eur ?? ""} onChange={(e) => setR({ sell_price_eur: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
        </div>

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Ingredients</h2>
        <fieldset disabled={isMirror} className="contents">
        <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-white">
          {ings.map((i, idx) => (
            <li key={i.id || `new-${idx}`} className="grid grid-cols-12 gap-2 px-3 py-2">
              <input
                placeholder="Name"
                value={i.ingredient_name}
                onChange={(e) => setIng(idx, { ingredient_name: e.target.value })}
                className="col-span-5 rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Qty" inputMode="decimal"
                value={i.quantity ?? ""}
                onChange={(e) => setIng(idx, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                className="col-span-2 rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Unit"
                value={i.unit ?? ""}
                onChange={(e) => setIng(idx, { unit: e.target.value || null })}
                className="col-span-2 rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Note"
                value={i.notes ?? ""}
                onChange={(e) => setIng(idx, { notes: e.target.value || null })}
                className="col-span-2 rounded-md border border-line px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => removeIng(idx)}
                className="col-span-1 rounded-md border border-line text-xs text-ink-soft hover:bg-black/5"
                aria-label="remove"
              >
                ×
              </button>
            </li>
          ))}
          <li className="px-3 py-2">
            <button
              onClick={addIng}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              + Add ingredient
            </button>
          </li>
        </ul>
        </fieldset>

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Cost</h2>
        <CostSection
          cost={cost}
          loading={costLoading}
          msg={costMsg}
          onRecompute={recomputeCost}
          houseSlug={houseSlug}
          sellPrice={recipe.sell_price_eur ?? null}
        />

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Method</h2>
        <textarea
          value={recipe.method ?? ""}
          readOnly={isMirror}
          onChange={(e) => setR({ method: e.target.value || null })}
          rows={10}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 font-serif text-sm leading-relaxed"
          placeholder="How to make it. Plain text or markdown."
        />

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Notes</h2>
        <textarea
          value={recipe.notes ?? ""}
          readOnly={isMirror}
          onChange={(e) => setR({ notes: e.target.value || null })}
          rows={3}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 font-serif text-sm leading-relaxed"
        />

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Explode to prep</h2>
        <div className="mt-1 grid grid-cols-1 gap-2 rounded-md border border-line bg-black/5 p-3 sm:grid-cols-4">
          <Field label="Service date">
            <input type="date" value={explodeDate} onChange={(e) => setExplodeDate(e.target.value)} className="w-full rounded-md border border-line px-3 py-2 text-sm bg-white" />
          </Field>
          <Field label="Target covers">
            <input inputMode="numeric" value={explodeCovers} onChange={(e) => setExplodeCovers(e.target.value)} className="w-full rounded-md border border-line px-3 py-2 text-sm bg-white" placeholder="e.g. 40" />
          </Field>
          <div className="sm:col-span-2 flex items-end">
            <button
              onClick={explode}
              className="w-full rounded-md bg-ink px-3 py-2 text-sm text-white hover:opacity-90"
            >
              Materialise prep rows
            </button>
          </div>
          {explodeMsg ? (
            <p className="sm:col-span-4 font-mono text-[11px] uppercase tracking-wide text-basil">{explodeMsg}</p>
          ) : null}
        </div>

        <div className="mt-8 border-t border-line pt-4">
          <button
            onClick={softDelete}
            className="rounded-md border border-tomato/40 px-3 py-2 text-[12px] font-mono uppercase tracking-wide text-tomato hover:bg-tomato/5"
          >
            Retire recipe
          </button>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ConfidenceChip({ c }: { c: "high" | "medium" | "low" | "missing" }) {
  const styles: Record<string, string> = {
    high:    "border-emerald-600 text-emerald-800 bg-emerald-50",
    medium:  "border-amber-600 text-amber-800 bg-amber-50",
    low:     "border-red-600 text-red-800 bg-red-50",
    missing: "border-black/30 text-ink-soft bg-black/5",
  };
  return (
    <span className={"inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide " + styles[c]}>
      {c}
    </span>
  );
}

function eur(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return "€" + Number(n).toFixed(2);
}

function CostSection({
  cost, loading, msg, onRecompute, houseSlug, sellPrice,
}: {
  cost: CostBreakdown | null;
  loading: boolean;
  msg: string | null;
  onRecompute: () => void;
  houseSlug: string;
  sellPrice: number | null;
}) {
  const showLie = cost && cost.confidence === "missing";
  const cpp = cost?.cost_per_portion_eur ?? null;
  const gm = cpp != null && sellPrice != null && sellPrice > 0
    ? ((sellPrice - cpp) / sellPrice) * 100
    : null;

  return (
    <div className="mt-1 rounded-md border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-4">
        <div>
          {showLie || cpp == null ? (
            <p className="font-serif italic text-ink-soft">no cost data yet</p>
          ) : (
            <p className="font-serif text-3xl text-ink">{eur(cpp)}<span className="font-mono text-[11px] uppercase tracking-wide text-clay"> /portion</span></p>
          )}
        </div>
        {cost ? <ConfidenceChip c={cost.confidence} /> : null}
        {gm != null && !showLie ? (
          <p className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">
            gross margin <span className={gm < 60 ? "text-red-700" : "text-emerald-700"}>{gm.toFixed(1)}%</span>
          </p>
        ) : null}
        <button
          onClick={onRecompute}
          disabled={loading}
          className="ml-auto rounded-md border border-line px-3 py-1.5 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5 disabled:opacity-50"
        >
          {loading ? "…" : "Recompute"}
        </button>
      </div>
      {msg ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">{msg}</p>
      ) : null}
      {cost && cost.breakdown.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-1 pr-2 font-mono text-[10px] uppercase tracking-wide text-clay">Ingredient</th>
                <th className="py-1 pr-2 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Qty</th>
                <th className="py-1 pr-2 font-mono text-[10px] uppercase tracking-wide text-clay">Unit</th>
                <th className="py-1 pr-2 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Unit €</th>
                <th className="py-1 pr-2 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Line €</th>
                <th className="py-1 pr-2 font-mono text-[10px] uppercase tracking-wide text-clay">Source</th>
              </tr>
            </thead>
            <tbody>
              {cost.breakdown.map((b, i) => (
                <tr
                  key={i}
                  className={"border-b border-black/5 align-top " + (b.status !== "priced" ? "bg-amber-50/60" : "")}
                >
                  <td className="py-1 pr-2">
                    <span className="font-serif text-[13px]">{b.ingredient_name}</span>
                    {b.canonical_name && b.canonical_name.toLowerCase() !== b.ingredient_name.toLowerCase() ? (
                      <span className="ml-1 font-mono text-[10px] uppercase tracking-wide text-clay">→ {b.canonical_name}</span>
                    ) : null}
                    {b.status === "no_alias" ? (
                      <Link
                        href={`/h/${houseSlug}/kitchen/ingredients?prefill=${encodeURIComponent(b.ingredient_name)}`}
                        className="ml-2 rounded-md border border-amber-500 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-800 hover:bg-amber-100"
                      >
                        + add alias
                      </Link>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono text-[12px]">{b.quantity ?? "—"}</td>
                  <td className="py-1 pr-2 font-mono text-[12px]">{b.unit ?? ""}</td>
                  <td className="py-1 pr-2 text-right font-mono text-[12px]">{eur(b.unit_price_eur)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-[12px]">{eur(b.line_cost_eur)}</td>
                  <td className="py-1 pr-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {b.status === "priced"
                      ? `purchase_lines ×${b.price_sample_count}`
                      : (b.note ?? b.status)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black/20">
                <td colSpan={4} className="pt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                  {cost.priced_count} of {cost.ingredient_count} priced · yield {cost.yield_qty}
                </td>
                <td className="pt-2 text-right font-mono text-[13px]">{eur(cost.total_recipe_cost_eur)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : cost && cost.ingredient_count === 0 ? (
        <p className="mt-2 font-serif italic text-ink-soft">Add ingredients above, then Recompute.</p>
      ) : null}
    </div>
  );
}
