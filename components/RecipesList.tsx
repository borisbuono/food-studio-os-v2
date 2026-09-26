"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

// Kitchen recipes list, phone-first. Groups by station, filters by
// category, ilike search on name. Same visual language as PrepList
// so the kitchen sees one consistent surface.

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
  cost_per_serving_eur: number | null;
  cost_per_portion: number | null;
  is_active: boolean;
  ingredient_count?: number;
  // Shared recipes (2026-09-21)
  is_mirror?: boolean;
  is_public?: boolean;
  public_slug?: string | null;
  is_draft?: boolean;
  is_mine?: boolean;
};

type View = "all" | "mine" | "shared" | "public" | "draft";
const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "public", label: "Public" },
  { key: "draft", label: "Draft" },
];

export default function RecipesList({ entityId, houseSlug }: { entityId: string; houseSlug: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("");
  const [view, setView] = useState<View>("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStation, setNewStation] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ entity: entityId });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/recipes?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setRecipes(j.recipes || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [entityId, search]);

  useEffect(() => { reload(); }, [reload]);

  const inView = useCallback((r: Recipe, v: View) =>
    v === "all" ? true
    : v === "mine" ? !r.is_mirror
    : v === "shared" ? !!r.is_mirror
    : v === "public" ? !!r.is_public
    : !!r.is_draft, []);

  const viewCounts = useMemo(() => {
    const c: Record<View, number> = { all: 0, mine: 0, shared: 0, public: 0, draft: 0 };
    for (const r of recipes) for (const v of VIEWS) if (inView(r, v.key)) c[v.key]++;
    return c;
  }, [recipes, inView]);

  const categories = useMemo(
    () => ["", ...Array.from(new Set(recipes.map((r) => r.category).filter(Boolean) as string[])).sort()],
    [recipes],
  );

  const filtered = useMemo(
    () => recipes.filter((r) => inView(r, view) && (!cat || (r.category || "") === cat)),
    [recipes, cat, view, inView],
  );

  const byStation = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of filtered) {
      const k = r.station || (r.category ? r.category.replace(/-/g, " ") : "Unassigned");
      (map.get(k) || map.set(k, []).get(k))!.push(r);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const createRecipe = useCallback(async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/recipes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          name: newName.trim(),
          station: newStation.trim() || null,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "create failed");
      setNewName(""); setNewStation(""); setCreating(false);
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [entityId, newName, newStation, reload]);

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
              {houseSlug.toUpperCase()} · Kitchen · Recipes
            </p>
            <h1 className="mt-0.5 font-serif text-xl leading-tight">{filtered.length} recipes</h1>
            <p className="font-serif italic text-[12px] text-ink-soft">Tap a recipe to open · Explode → prep from detail</p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/h/${houseSlug}/kitchen/prep`}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              Prep list
            </Link>
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              {creating ? "Cancel" : "New recipe"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[10rem] flex-1 rounded-md border border-line px-3 py-2 text-sm"
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded-md border border-line px-3 py-2 text-sm"
          >
            {categories.map((c) => (
              <option key={c || "all"} value={c}>{c ? c : "all categories"}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Recipe filter">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={
                "rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide " +
                (view === v.key ? "border-ink bg-ink text-white" : "border-line text-ink-soft hover:bg-black/5")
              }
            >
              {v.label} · {viewCounts[v.key]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-clay">🌐 public · 🔗 shared (edit on origin) · ✏️ editable here</p>

        {creating ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              autoFocus placeholder="Recipe name (required)"
              value={newName} onChange={(e) => setNewName(e.target.value)}
              className="rounded-md border border-line px-3 py-2 text-sm sm:col-span-2"
            />
            <input
              placeholder="Station" value={newStation} onChange={(e) => setNewStation(e.target.value)}
              className="rounded-md border border-line px-3 py-2 text-sm"
            />
            <button
              onClick={createRecipe} disabled={busy || !newName.trim()}
              className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50 sm:col-span-3"
            >
              Create recipe
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">
          {error}
        </div>
      ) : null}

      {loading && recipes.length === 0 ? (
        <p className="px-4 py-8 font-serif italic text-ink-soft">Loading…</p>
      ) : recipes.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="font-serif italic text-ink-soft">No recipes yet.</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
            Tap New recipe, or Save-as-recipe from the prep list.
          </p>
        </div>
      ) : (
        <section className="px-2 pb-24 pt-2 sm:px-4">
          {byStation.map(([station, rows]) => (
            <div key={station} className="mt-4">
              <h2 className="px-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                {station} · {rows.length}
              </h2>
              <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-white">
                {rows.map((r) => {
                  const cost = r.cost_per_portion ?? r.cost_per_serving_eur ?? null;
                  const margin = r.sell_price_eur != null && cost != null && r.sell_price_eur > 0
                    ? ((r.sell_price_eur - cost) / r.sell_price_eur) * 100
                    : null;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/h/${houseSlug}/menu/recipes/${r.id}`}
                        className="flex items-center gap-3 px-3 py-3 hover:bg-black/5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-serif text-[16px] leading-tight">
                            {r.name}
                            <span className="ml-2 whitespace-nowrap text-[12px]" aria-hidden>
                              {r.is_public ? "🌐" : ""}{r.is_mirror ? "🔗" : "✏️"}
                            </span>
                            {r.is_draft ? <span className="ml-1 font-mono text-[9px] uppercase tracking-wide text-tomato">draft</span> : null}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-clay">
                            {r.category || "—"}
                            {r.yield_qty != null ? ` · yields ${formatQty(r.yield_qty)} ${r.yield_unit || ""}` : ""}
                            {r.portion_size != null ? ` · ${formatQty(r.portion_size)}${r.portion_unit || "g"}/portion` : ""}
                            {r.ingredient_count ? ` · ${r.ingredient_count} components` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {r.sell_price_eur != null ? (
                            <p className="font-serif text-[14px]">€{r.sell_price_eur.toFixed(2)}</p>
                          ) : null}
                          {margin != null ? (
                            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                              {margin.toFixed(0)}% GM
                            </p>
                          ) : cost != null ? (
                            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                              cost €{cost.toFixed(2)}
                            </p>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}
