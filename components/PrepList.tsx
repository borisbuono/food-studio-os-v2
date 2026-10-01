"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getLang, t, type Lang } from "@/lib/i18n";

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

// Labels through t() (cook path 2026-10-02) — prep.filter.* in lib/i18nDict.ts.
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",         label: "prep.filter.all" },
  { key: "todo",        label: "prep.filter.todo" },
  { key: "in_progress", label: "prep.filter.in_progress" },
  { key: "done",        label: "prep.filter.done" },
  { key: "skipped",     label: "prep.filter.skipped" },
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
  // fs_lang cookie, read after mount so SSR (EN) and the first client render agree.
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);
  const tr = (k: string, vars?: Record<string, string | number>) => {
    let s = t(k, lang);
    if (vars) for (const [kk, v] of Object.entries(vars)) s = s.split("{" + kk + "}").join(String(v));
    return s;
  };
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
  // "Generate prep for tonight" (menu-first loop, slice 3): the batch it
  // inserted, kept so one tap can take it back.
  const [lastBatch, setLastBatch] = useState<{ ids: string[]; inserted: number; skipped: number } | null>(null);

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

  const generateFromMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/list/from-menu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id: entityId, service_date: serviceDate }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "generate failed");
      setLastBatch({ ids: j.ids || [], inserted: j.inserted || 0, skipped: j.skipped || 0 });
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setLoading(false);
    }
  }, [entityId, serviceDate, reload]);

  const undoBatch = useCallback(async () => {
    if (!lastBatch?.ids.length) { setLastBatch(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/prep/list/undo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: lastBatch.ids }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "undo failed");
      setLastBatch(null);
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setLoading(false);
    }
  }, [lastBatch, reload]);

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
        window.location.href = `/h/${houseSlug}/menu/recipes/${j.recipe.id}`;
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
              {houseSlug.toUpperCase()} · {tr("prep.eyebrow")}
            </p>
            <h1 className="mt-0.5 font-serif text-xl leading-tight">
              {tr("prep.done_of", { done: doneCount, total: items.length })}
            </h1>
            <p className="font-serif italic text-[12px] text-ink-soft">{serviceDate}</p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/h/${houseSlug}/menu/recipes`}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5 text-center"
            >
              {tr("prep.recipes")}
            </Link>
            <button
              onClick={generateFromMenu}
              disabled={loading}
              className="rounded-md bg-ink px-3 py-2 text-[12px] font-mono uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-50"
            >
              {tr("prep.for_tonight")}
            </button>
            <button
              onClick={generateFromTemplate}
              disabled={loading}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5 disabled:opacity-50"
            >
              {tr("prep.from_template")}
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
            >
              {adding ? tr("prep.cancel") : tr("prep.add_item")}
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
                {tr(f.label)}
              </button>
            );
          })}
        </div>

        {lastBatch ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line bg-black/[0.03] px-3 py-2">
            <p className="font-sans text-[12px] text-ink">
              {lastBatch.inserted === 1 ? tr("prep.batch.added_one") : tr("prep.batch.added", { n: lastBatch.inserted })}{lastBatch.skipped ? ` · ${tr("prep.batch.skipped", { n: lastBatch.skipped })}` : ""}. {tr("prep.batch.hint")}
            </p>
            <div className="flex shrink-0 gap-2">
              <button onClick={undoBatch} disabled={loading} className="rounded-md border border-line px-3 py-1 text-[11px] font-mono uppercase tracking-wide hover:bg-black/5 disabled:opacity-50">{tr("prep.undo")}</button>
              <button onClick={() => setLastBatch(null)} className="rounded-md px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-clay hover:text-ink">{tr("prep.keep")}</button>
            </div>
          </div>
        ) : null}

        {adding ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              autoFocus placeholder={tr("prep.ph.name")}
              value={addName} onChange={(e) => setAddName(e.target.value)}
              className="col-span-2 rounded-md border border-line px-3 py-2 text-sm"
            />
            <input
              placeholder={tr("prep.ph.station")} value={addStation} onChange={(e) => setAddStation(e.target.value)}
              className="rounded-md border border-line px-3 py-2 text-sm"
            />
            <div className="flex gap-1">
              <input
                placeholder={tr("prep.ph.qty")} inputMode="decimal" value={addQty} onChange={(e) => setAddQty(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <input
                placeholder={tr("prep.ph.unit")} value={addUnit} onChange={(e) => setAddUnit(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={addItem} disabled={busy.has("__add__") || !addName.trim()}
              className="col-span-2 rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50 sm:col-span-4"
            >
              {tr("prep.add_to_list")}
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
        <p className="px-4 py-8 font-serif italic text-ink-soft">{tr("prep.loading")}</p>
      ) : items.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="font-serif italic text-ink-soft">{tr("prep.empty", { date: serviceDate })}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
            {tr("prep.empty.hint")}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-8 font-serif italic text-ink-soft">{tr("prep.filter.empty")}</p>
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
                          {it.per_cover != null ? ` · ${it.per_cover}${tr("prep.per_cover")}` : ""}
                          {it.target_covers != null ? ` · ${it.target_covers} ${tr("prep.covers")}` : ""}
                        </p>
                      </div>
                      {it.linked_recipe_id ? (
                        <Link
                          href={`/h/${houseSlug}/menu/recipes/${it.linked_recipe_id}`}
                          className="shrink-0 rounded-full border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:bg-black/5"
                          aria-label="open linked recipe"
                        >
                          {tr("prep.recipe_link")}
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
        <div className="fixed inset-x-0 z-20 border-t border-line bg-white/95 px-4 py-3 shadow-lg backdrop-blur" style={{ bottom: "var(--chef-dock)" }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
              {tr("prep.selected", { n: selected.size })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-md border border-line px-3 py-2 text-[12px] font-mono uppercase tracking-wide hover:bg-black/5"
              >
                {tr("prep.clear")}
              </button>
              <button
                onClick={saveSelectedAsRecipe}
                disabled={savingRecipe}
                className="rounded-md bg-ink px-3 py-2 text-[12px] font-mono uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingRecipe ? tr("prep.saving") : tr("prep.save_recipe")}
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
