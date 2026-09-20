"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

// Full-screen prep list — kitchen team's phones are the primary surface,
// so tap targets are big, chrome is stripped, and the checkbox is a giant
// square on the left. Grouped by station.

type PrepItem = {
  id: string;
  entity_id: string;
  service_date: string;
  station: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  per_cover: number | null;
  target_covers: number | null;
  status: "todo" | "in_progress" | "done" | "skipped";
  assignee_id: string | null;
  notes: string | null;
  linked_recipe_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

type Filter = "all" | "todo" | "in_progress" | "done" | "skipped";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",         label: "All" },
  { key: "todo",        label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done",        label: "Done" },
  { key: "skipped",     label: "Skipped" },
];

const NEXT_STATUS: Record<PrepItem["status"], PrepItem["status"]> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",       // undo
  skipped: "todo",
};

export default function PrepList({
  entityId,
  serviceDate,
  houseSlug,
}: {
  entityId: string;
  serviceDate: string;
  houseSlug: string;
}) {
  const [items, setItems] = useState<PrepItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addStation, setAddStation] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addUnit, setAddUnit] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingRecipe, setSavingRecipe] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/list?entity=${entityId}&date=${serviceDate}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setItems(j.items || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [entityId, serviceDate]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const byStation = useMemo(() => {
    const map = new Map<string, PrepItem[]>();
    for (const i of filtered) {
      const k = i.station || "Unassigned";
      (map.get(k) || map.set(k, []).get(k))!.push(i);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const doneCount = items.filter((i) => i.status === "done").length;

  const cycleStatus = useCallback(async (item: PrepItem) => {
    const next = NEXT_STATUS[item.status];
    setBusy((b) => new Set(b).add(item.id));
    // Optimistic
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, status: next } : x)));
    try {
      const res = await fetch(`/api/prep/item/${item.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "update failed");
      setItems((xs) => xs.map((x) => (x.id === item.id ? j.item : x)));
    } catch (e: any) {
      setError(String(e?.message || e));
      reload();
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(item.id); return n; });
    }
  }, [reload]);

  const generateFromTemplate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/list/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id: entityId, service_date: serviceDate }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "generate failed");
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setLoading(false);
    }
  }, [entityId, serviceDate, reload]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const saveSelectedAsRecipe = useCallback(async () => {
    if (selected.size === 0) return;
    setSavingRecipe(true); setError(null);
    try {
      const ids = Array.from(selected);
      const res = await fetch(`/api/recipes/from-prep`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id: entityId, prep_item_ids: ids }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "save failed");
      setSelected(new Set());
      await reload();
      if (j?.recipe?.id) {
        window.location.href = `/h/${houseSlug}/kitchen/recipes/${j.recipe.id}`;
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSavingRecipe(false);
    }
  }, [entityId, selected, reload, houseSlug]);

  const addItem = useCallback(async () => {
    if (!addName.trim()) return;
    setBusy((b) => new Set(b).add("__add__"));
    try {
      const res = await fetch(`/api/prep/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          service_date: serviceDate,
          name: addName.trim(),
          station: addStation.trim() || null,
          quantity: addQty ? Number(addQty) : null,
          unit: addUnit.trim() || null,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "add failed");
      setAddName(""); setAddQty(""); setAddUnit(""); setAddStation("");
      setAdding(false);
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete("__add__"); return n; });
    }
  }, [addName, addStation, addQty, addUnit, entityId, serviceDate, reload]);

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
              {houseSlug.toUpperCase()} · Kitchen · Prep
            </p>
            <h1 className="mt-0.5 font-serif text-xl leading-tight">
              {doneCount} of {items.length} done
            </h1>
            <p className="font-serif italic text-[12px] text-ink-soft">{serviceDate}</p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/h/${houseSlug}/kitchen/recipes`}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5 text-center"
            >
              Recipes
            </Link>
            <button
              onClick={generateFromTemplate}
              disabled={loading}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5 disabled:opacity-50"
            >
              Generate from template
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              {adding ? "Cancel" : "Add item"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  "shrink-0 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-wide " +
                  (on ? "border-ink bg-ink text-white" : "border-line text-ink-soft hover:bg-black/5")
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {adding ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              autoFocus placeholder="Name (required)"
              value={addName} onChange={(e) => setAddName(e.target.value)}
              className="col-span-2 rounded-md border border-line px-3 py-2 text-sm"
            />
            <input
              placeholder="Station" value={addStation} onChange={(e) => setAddStation(e.target.value)}
              className="rounded-md border border-line px-3 py-2 text-sm"
            />
            <div className="flex gap-1">
              <input
                placeholder="Qty" inputMode="decimal" value={addQty} onChange={(e) => setAddQty(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <input
                placeholder="Unit" value={addUnit} onChange={(e) => setAddUnit(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={addItem} disabled={busy.has("__add__") || !addName.trim()}
              className="col-span-2 rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50 sm:col-span-4"
            >
              Add to prep list
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <p className="px-4 py-8 font-serif italic text-ink-soft">Loading…</p>
      ) : items.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="font-serif italic text-ink-soft">Prep list is empty for {serviceDate}.</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
            Tap Generate to pull today's templates, or Add item to start from scratch.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-8 font-serif italic text-ink-soft">Nothing matches the {filter} filter.</p>
      ) : (
        <section className="px-2 pb-24 pt-2 sm:px-4">
          {byStation.map(([station, rows]) => (
            <div key={station} className="mt-4">
              <h2 className="px-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                {station} · {rows.length}
              </h2>
              <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-white">
                {rows.map((it) => {
                  const done = it.status === "done";
                  const inProg = it.status === "in_progress";
                  const skipped = it.status === "skipped";
                  const isSel = selected.has(it.id);
                  return (
                    <li key={it.id} className="flex items-center gap-3 px-3 py-3">
                      <button
                        onClick={() => cycleStatus(it)}
                        disabled={busy.has(it.id)}
                        aria-label={`toggle ${it.name}`}
                        className={
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border transition " +
                          (done
                            ? "border-basil bg-basil text-white"
                            : inProg
                              ? "border-[#B27A08] bg-[#B27A08]/10 text-[#B27A08]"
                              : skipped
                                ? "border-line bg-black/5 text-ink-soft"
                                : "border-ink text-ink hover:bg-black/5")
                        }
                      >
                        {done ? "✓" : inProg ? "…" : skipped ? "–" : ""}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={"font-serif text-[16px] leading-tight " + (done ? "text-ink-soft line-through" : "")}>
                          {it.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-clay">
                          {it.quantity != null ? `${formatQty(it.quantity)} ${it.unit || ""}`.trim() : (it.unit || "")}
                          {it.per_cover != null ? ` · ${it.per_cover}/cover` : ""}
                          {it.target_covers != null ? ` · ${it.target_covers} covers` : ""}
                        </p>
                      </div>
                      {it.linked_recipe_id ? (
                        <Link
                          href={`/h/${houseSlug}/kitchen/recipes/${it.linked_recipe_id}`}
                          className="shrink-0 rounded-full border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:bg-black/5"
                          aria-label="open linked recipe"
                        >
                          → recipe
                        </Link>
                      ) : null}
                      <button
                        onClick={() => toggleSelect(it.id)}
                        aria-label="select for recipe"
                        className={
                          "shrink-0 flex h-8 w-8 items-center justify-center rounded-md border text-xs " +
                          (isSel ? "border-ink bg-ink text-white" : "border-line text-ink-soft hover:bg-black/5")
                        }
                      >
                        {isSel ? "✓" : "◇"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {selected.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
              {selected.size} selected
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
              >
                Clear
              </button>
              <button
                onClick={saveSelectedAsRecipe}
                disabled={savingRecipe}
                className="rounded-md bg-ink px-3 py-2 text-[12px] font-mono uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingRecipe ? "Saving…" : "Save as recipe"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}
