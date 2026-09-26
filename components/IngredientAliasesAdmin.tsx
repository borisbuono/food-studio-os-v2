"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Alias = {
  id: string;
  canonical_name: string;
  alias: string;
  unit: string | null;
  unit_conversion: number;
  created_at: string;
};

// /h/[slug]/menu/ingredients — admin surface for ingredient_aliases.
// One row per alias variant. Boris types the canonical name, the supplier
// spelling (as it appears on purchase_lines), and a unit. Conversion is
// left at 1 unless the alias is in a different unit than the canonical.

export default function IngredientAliasesAdmin({
  entityId, houseSlug, prefill,
}: { entityId: string; houseSlug: string; prefill: string | null }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const [newCanonical, setNewCanonical] = useState("");
  const [newAlias, setNewAlias] = useState(prefill || "");
  const [newUnit, setNewUnit] = useState<string>("kg");
  const [newConversion, setNewConversion] = useState<string>("1");
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/ingredient-aliases?entity=${encodeURIComponent(entityId)}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setAliases(j.aliases || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  }, [entityId]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async () => {
    const canonical = newCanonical.trim();
    const alias = newAlias.trim();
    if (!canonical || !alias) { setError("canonical and alias required"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/ingredient-aliases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          canonical_name: canonical,
          alias,
          unit: newUnit || null,
          unit_conversion: Number(newConversion) || 1,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "save failed");
      setNewCanonical(""); setNewAlias(""); setNewUnit("kg"); setNewConversion("1");
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setSaving(false); }
  }, [entityId, newCanonical, newAlias, newUnit, newConversion, reload]);

  const patch = useCallback(async (id: string, patch: Partial<Alias>) => {
    try {
      const res = await fetch("/api/ingredient-aliases", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "patch failed");
    } catch (e: any) { setError(String(e?.message || e)); }
  }, []);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Remove this alias?")) return;
    const res = await fetch(`/api/ingredient-aliases?id=${id}`, { method: "DELETE" });
    const j = await res.json();
    if (!j?.ok) { setError(j?.error || "delete failed"); return; }
    await reload();
  }, [reload]);

  const seedAuto = useCallback(async () => {
    if (!confirm("Auto-seed from purchase_lines? Adds obvious plural/case variants; safe to re-run.")) return;
    setSeedMsg(null);
    const res = await fetch(`/api/ingredient-aliases/seed?entity=${encodeURIComponent(entityId)}`, { method: "POST" });
    const j = await res.json();
    if (!j?.ok) { setSeedMsg(j?.error || "seed failed"); return; }
    setSeedMsg(`Seeded ${j.inserted} new aliases across ${j.clusters} clusters (${j.scanned_rows} purchase lines scanned).`);
    await reload();
  }, [entityId, reload]);

  const filtered = filter
    ? aliases.filter((a) =>
        a.alias.toLowerCase().includes(filter.toLowerCase()) ||
        a.canonical_name.toLowerCase().includes(filter.toLowerCase())
      )
    : aliases;

  // Group by canonical_name for a slightly saner UX
  const byCanonical = new Map<string, Alias[]>();
  for (const a of filtered) {
    const list = byCanonical.get(a.canonical_name) || [];
    list.push(a);
    byCanonical.set(a.canonical_name, list);
  }

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
              {houseSlug.toUpperCase()} · Kitchen · Ingredients
            </p>
            <h1 className="font-serif text-xl leading-tight">Ingredient aliases</h1>
          </div>
          <Link
            href={`/h/${houseSlug}/menu/recipes`}
            className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
          >
            Back
          </Link>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">
          {error}
        </div>
      ) : null}

      <section className="px-4 pt-4 pb-24">
        <div className="rounded-md border border-line bg-black/5 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Add alias</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-5">
            <input
              placeholder="Canonical (e.g. Tomate)"
              value={newCanonical}
              onChange={(e) => setNewCanonical(e.target.value)}
              className="rounded-md border border-line bg-white px-3 py-2 text-sm"
            />
            <input
              placeholder="Supplier variant (as on invoice)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              className="sm:col-span-2 rounded-md border border-line bg-white px-3 py-2 text-sm"
            />
            <input
              placeholder="Unit (kg, l, ud)"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              className="rounded-md border border-line bg-white px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                placeholder="× 1"
                value={newConversion}
                onChange={(e) => setNewConversion(e.target.value)}
                inputMode="decimal"
                className="w-16 rounded-md border border-line bg-white px-2 py-2 text-sm"
              />
              <button
                onClick={add}
                disabled={saving}
                className="flex-1 rounded-md bg-ink px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "…" : "Add"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={seedAuto}
              className="rounded-md border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide hover:bg-white"
            >
              Auto-seed from purchase_lines
            </button>
            {seedMsg ? (
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{seedMsg}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            {aliases.length} aliases · {byCanonical.size} canonical
          </p>
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-line px-2 py-1 text-sm"
          />
        </div>

        {loading ? (
          <p className="mt-3 font-serif italic text-ink-soft">Loading…</p>
        ) : (
          <div className="mt-2 divide-y divide-line rounded-md border border-line bg-white">
            {[...byCanonical.entries()].map(([canonical, rows]) => (
              <div key={canonical} className="px-3 py-2">
                <p className="font-serif text-[15px]">{canonical}</p>
                <ul className="mt-1 divide-y divide-line/40">
                  {rows.map((a) => (
                    <li key={a.id} className="grid grid-cols-12 items-center gap-2 py-1.5">
                      <input
                        defaultValue={a.alias}
                        onBlur={(e) => { if (e.target.value !== a.alias) patch(a.id, { alias: e.target.value }); }}
                        className="col-span-6 rounded-md border border-line px-2 py-1 text-sm"
                      />
                      <input
                        defaultValue={a.unit ?? ""}
                        onBlur={(e) => { const v = e.target.value || null; if (v !== a.unit) patch(a.id, { unit: v }); }}
                        className="col-span-2 rounded-md border border-line px-2 py-1 text-sm"
                      />
                      <input
                        defaultValue={String(a.unit_conversion)}
                        onBlur={(e) => { const v = Number(e.target.value) || 1; if (v !== a.unit_conversion) patch(a.id, { unit_conversion: v }); }}
                        inputMode="decimal"
                        className="col-span-2 rounded-md border border-line px-2 py-1 text-sm"
                      />
                      <input
                        defaultValue={canonical}
                        onBlur={(e) => { if (e.target.value !== canonical) patch(a.id, { canonical_name: e.target.value }); }}
                        className="col-span-1 rounded-md border border-line px-2 py-1 text-xs"
                        title="edit canonical name"
                      />
                      <button
                        onClick={() => remove(a.id)}
                        className="col-span-1 rounded-md border border-line text-xs text-ink-soft hover:bg-black/5"
                        aria-label="remove"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!filtered.length ? (
              <p className="px-3 py-4 font-serif italic text-ink-soft">
                No aliases yet. Type one above, or auto-seed from purchase_lines.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
