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
      const res = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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

      <section className="px-4 pb-24 pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Station">
            <input value={recipe.station ?? ""} onChange={(e) => setR({ station: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Category">
            <select value={recipe.category ?? ""} onChange={(e) => setR({ category: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm">
              {["", "starter", "main", "dessert", "side", "sauce", "stock", "component"].map((c) => (
                <option key={c || "none"} value={c}>{c || "—"}</option>
              ))}
            </select>
          </Field>
          <Field label="Yield qty">
            <input inputMode="decimal" value={recipe.yield_qty ?? ""} onChange={(e) => setR({ yield_qty: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Yield unit">
            <input value={recipe.yield_unit ?? ""} onChange={(e) => setR({ yield_unit: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Portion size">
            <input inputMode="decimal" value={recipe.portion_size ?? ""} onChange={(e) => setR({ portion_size: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Portion unit">
            <input value={recipe.portion_unit ?? ""} onChange={(e) => setR({ portion_unit: e.target.value || null })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Cover multiplier">
            <input inputMode="decimal" value={recipe.cover_multiplier ?? ""} onChange={(e) => setR({ cover_multiplier: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Sell price €">
            <input inputMode="decimal" value={recipe.sell_price_eur ?? ""} onChange={(e) => setR({ sell_price_eur: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          </Field>
        </div>

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Ingredients</h2>
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

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Method</h2>
        <textarea
          value={recipe.method ?? ""}
          onChange={(e) => setR({ method: e.target.value || null })}
          rows={10}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 font-serif text-sm leading-relaxed"
          placeholder="How to make it. Plain text or markdown."
        />

        <h2 className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Notes</h2>
        <textarea
          value={recipe.notes ?? ""}
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
