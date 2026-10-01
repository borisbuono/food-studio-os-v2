"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MenuLoopItem } from "@/app/api/menu/items/route";

// The margin page — menu-first loop (Boris 2026-10-01).
//
// Every row is a line on the printed menu. Reading left to right: dish, what
// it sells for, what it costs us, the margin, and HOW SURE we are of that cost
// (real = every line priced from an invoice; estimate = at least one
// provisional price or an estimated quantity; unbound = no recipe yet).
// Worst margin first. Tap the dish → its recipe's Costing tab.
//
// The only control is the bind: a low-confidence match is shown as a
// question ("is this the recipe?") with one tap to accept, the three nearest
// to pick from, or "new shell" when we hold nothing. Nothing here publishes a
// recipe; shells stay needs_boris_review.

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2).replace(".", ",") + " €");
const pct = (n: number | null | undefined) => (n == null ? "—" : Math.round(n) + " %");
const TARGET_FC = 30; // food-cost % above which a dish is "below 70 % margin" — Boris's idle chip reads "below 30 % margin" on the margin side

type Filter = "all" | "worst" | "question" | "estimate";

export default function Margin({ entityId, houseSlug }: { entityId: string; houseSlug: string }) {
  const [items, setItems] = useState<MenuLoopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // row with the picker open
  const [filter, setFilter] = useState<Filter>("all");

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/menu/items?entity=${entityId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setItems(j.items || []);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [entityId]);
  useEffect(() => { reload(); }, [reload]);

  const act = useCallback(async (id: string, body: any) => {
    setBusy(id); setError(null);
    try {
      const r = await fetch(`/api/menu/items/${id}/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "bind failed");
      setOpen(null);
      await reload();
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [reload]);

  const recost = useCallback(async () => {
    setBusy("__recost__"); setError(null);
    try {
      const r = await fetch(`/api/menu/recost`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity_id: entityId }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "recost failed");
      await reload();
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [entityId, reload]);

  // A match is a QUESTION when the OS set it with less than full confidence and no human has tapped yet.
  const isQuestion = (i: MenuLoopItem) => i.recipe_match_method !== "none" && i.category !== "set_menu" && (!i.recipe_id || ((i.recipe_match_score ?? 0) < 0.8 && i.recipe_match_method !== "human" && i.recipe_match_method !== "shell"));
  const isDish = (i: MenuLoopItem) => i.recipe_match_method !== "none" || i.category === "set_menu";
  const dishes = useMemo(() => items.filter(isDish), [items]);
  const stats = useMemo(() => {
    const s = { dishes: dishes.length, bound: 0, real: 0, estimate: 0, unbound: 0, worst: 0, questions: 0 };
    for (const i of dishes) {
      if (i.recipe_id) s.bound++; else s.unbound++;
      if (i.cost_confidence === "real") s.real++;
      else if (i.cost_confidence === "estimate" || i.cost_confidence === "partial") s.estimate++;
      if (i.food_cost_pct != null && i.food_cost_pct > TARGET_FC && (i.price ?? 0) > 0) s.worst++;
      if (isQuestion(i)) s.questions++;
    }
    return s;
  }, [dishes]);

  const shown = useMemo(() => {
    switch (filter) {
      case "worst": return dishes.filter((i) => i.food_cost_pct != null && i.food_cost_pct > TARGET_FC && (i.price ?? 0) > 0);
      case "question": return dishes.filter(isQuestion);
      case "estimate": return dishes.filter((i) => i.cost_confidence === "estimate" || i.cost_confidence === "partial");
      default: return dishes;
    }
  }, [dishes, filter]);

  const recipeHref = (i: MenuLoopItem) => (i.recipe_id ? `/h/${houseSlug}/menu/recipes/${i.recipe_id}?tab=cost` : null);

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-0 py-4 bg-paper">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">The menu, costed</p>
          <p className="mt-2 font-serif text-[20px] font-light leading-snug text-ink">
            {stats.dishes} dishes · {stats.real} costed from invoices · {stats.estimate} on estimates · {stats.unbound} without a recipe
            {stats.worst ? <> · <span className="text-tomato">{stats.worst} below {100 - TARGET_FC} % margin</span></> : null}
          </p>
        </div>
        <button onClick={recost} disabled={busy != null} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide hover:bg-black/5 disabled:opacity-50">
          {busy === "__recost__" ? "Costing…" : "Recost now"}
        </button>
      </div>

      <div className="mt-3 flex gap-1 overflow-x-auto">
        {([["all", "All"], ["worst", `Below margin ${stats.worst ? "· " + stats.worst : ""}`], ["question", `Questions ${stats.questions ? "· " + stats.questions : ""}`], ["estimate", `Estimates ${stats.estimate ? "· " + stats.estimate : ""}`]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={"shrink-0 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide " + (filter === k ? "border-ink bg-ink text-white" : "border-line text-ink-soft hover:bg-black/5")}>{label}</button>
        ))}
      </div>

      {error ? <div className="mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{error}</div> : null}
      {loading && !items.length ? <p className="py-8 font-serif italic text-ink-soft">Loading…</p> : null}
      {!loading && !shown.length ? <p className="py-8 font-serif italic text-ink-soft">Nothing here.</p> : null}

      <ul className="mt-2 divide-y divide-line-soft">
        {shown.map((i) => {
          const q = isQuestion(i);
          const margin = i.price && i.computed_cost != null ? ((i.price - i.computed_cost) / i.price) * 100 : null;
          const bad = i.food_cost_pct != null && i.food_cost_pct > TARGET_FC && (i.price ?? 0) > 0;
          const href = recipeHref(i);
          return (
            <li key={i.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  {href ? <Link href={href} className="font-serif text-[17px] text-ink hover:opacity-70">{i.name}</Link> : <span className="font-serif text-[17px] text-ink">{i.name}</span>}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-clay">{i.section}</span>
                </div>
                <div className="shrink-0 text-right font-mono text-[12px] tabular-nums">
                  <span className="text-ink-soft">{i.price && i.price > 0 ? eur(i.price) : "in menu"}</span>
                  <span className="mx-2 text-line">·</span>
                  <span className="text-ink-soft">{eur(i.computed_cost)}</span>
                  <span className="mx-2 text-line">·</span>
                  <span className={bad ? "text-tomato" : "text-ink"}>{i.price && i.price > 0 ? pct(margin) : eur(i.computed_cost) === "—" ? "—" : "cost only"}</span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em]">
                <Badge conf={i.cost_confidence} bound={!!i.recipe_id || i.category === "set_menu"} />
                {i.recipe_name ? <span className="text-ink-soft normal-case tracking-normal font-sans text-[12px]">→ {i.recipe_name}{i.recipe_needs_review && !i.recipe_quantities_estimated ? " · awaiting review" : ""}</span> : null}
                {i.recipe_id && i.recipe_quantities_estimated ? (
                  <span className="normal-case tracking-normal font-sans text-[12px] text-[#B27A08]">quantities estimated —
                    {href ? <Link href={href} className="ml-1 underline hover:text-ink">check</Link> : null}
                    <button disabled={busy === i.id} onClick={() => act(i.id, { quantities_ok: true })} className="ml-2 rounded-sm border border-[#B27A08]/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide hover:bg-[#B27A08]/10 disabled:opacity-50">they&apos;re right</button>
                  </span>
                ) : null}
                {i.recipe_id && !q ? (
                  <button onClick={() => setOpen(open === i.id ? null : i.id)} className="text-clay hover:text-ink">change</button>
                ) : null}
              </div>

              {(q || open === i.id) ? (
                <div className="mt-2 rounded-md border border-line bg-card px-3 py-2">
                  {q && i.recipe_id ? (
                    <p className="font-sans text-[13px] text-ink">Is <em>{i.recipe_name}</em> the recipe for this dish? <span className="text-ink-soft">(matched by {i.recipe_match_method}, {Math.round((i.recipe_match_score ?? 0) * 100)} %)</span></p>
                  ) : !i.recipe_id ? (
                    <p className="font-sans text-[13px] text-ink">No recipe bound. Pick one, or start a shell.</p>
                  ) : (
                    <p className="font-sans text-[13px] text-ink">Bind a different recipe.</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q && i.recipe_id ? (
                      <button disabled={busy === i.id} onClick={() => act(i.id, { accept: true })} className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">Yes, that one</button>
                    ) : null}
                    {i.recipe_candidates.filter((c) => c.recipe_id !== i.recipe_id).slice(0, 3).map((c) => (
                      <button key={c.recipe_id} disabled={busy === i.id} onClick={() => act(i.id, { recipe_id: c.recipe_id })} className="rounded-md border border-line px-3 py-1.5 font-sans text-[12px] text-ink hover:bg-black/5 disabled:opacity-50">
                        {c.name} <span className="font-mono text-[10px] text-clay">{Math.round(c.score * 100)} %{c.line_count != null ? ` · ${c.line_count} lines` : ""}</span>
                      </button>
                    ))}
                    <button disabled={busy === i.id} onClick={() => act(i.id, { shell: true })} className="rounded-md border border-dashed border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:bg-black/5 disabled:opacity-50">New shell</button>
                    {i.recipe_id && open === i.id ? (
                      <button disabled={busy === i.id} onClick={() => act(i.id, { unbind: true })} className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-clay hover:text-tomato disabled:opacity-50">Unbind</button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <PricesToConfirm entityId={entityId} onChanged={reload} />

      {items.some((i) => i.recipe_match_method === "none" && i.category !== "set_menu") ? (
        <p className="mt-8 border-t border-line pt-4 font-sans text-[12px] text-ink-soft">
          {items.filter((i) => i.recipe_match_method === "none" && i.category !== "set_menu").length} lines on the menu are bought as sold (wine, coffee, extras) and carry no recipe — their cost is the purchase price, read on the Supplies screen.
        </p>
      ) : null}
    </main>
  );
}

function Badge({ conf, bound }: { conf: string | null; bound: boolean }) {
  if (!bound) return <span className="rounded-sm border border-tomato/50 px-1.5 py-0.5 text-tomato">unbound</span>;
  if (conf === "real") return <span className="rounded-sm border border-basil/60 px-1.5 py-0.5 text-basil">real</span>;
  if (conf === "estimate" || conf === "partial") return <span className="rounded-sm border border-[#B27A08]/60 px-1.5 py-0.5 text-[#B27A08]">estimate</span>;
  return <span className="rounded-sm border border-line px-1.5 py-0.5 text-clay">not costed</span>;
}

// The provisional prices the costing leans on, most-used first. One tap keeps
// the estimate as a confirmed price; a typed number replaces it. Either way
// the menu is re-costed in the same request. This is the one thing the
// operator owes the loop (Foundation §7.3) — and it is one tap per line.
type PriceRow = { id: string; canonical_name: string; unit: string; price_eur: number; source: string; needs_confirm: boolean; uses: number; note: string | null; price_asof: string | null };

function PricesToConfirm({ entityId, onChanged }: { entityId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/menu/prices?entity=${entityId}&only=confirm`, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setRows(j.prices || []);
    } catch { /* the list is a convenience; the page still works without it */ }
  }, [entityId]);
  useEffect(() => { load(); }, [load]);

  const confirm = useCallback(async (id: string, price?: string) => {
    setBusy(id); setErr(null);
    try {
      const body: any = {};
      if (price != null && price.trim() !== "") body.price_eur = Number(price.replace(",", "."));
      const r = await fetch(`/api/menu/prices/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "confirm failed");
      setEdit((e) => { const n = { ...e }; delete n[id]; return n; });
      await load(); onChanged();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [load, onChanged]);

  if (!rows.length) return null;
  const shown = open ? rows : rows.slice(0, 8);
  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Prices to confirm · {rows.length}</p>
          <p className="mt-1 font-sans text-[13px] text-ink-soft">Estimates the costing is leaning on until an invoice line or your tick replaces them. Tap to keep, or type the real price.</p>
        </div>
        {rows.length > 8 ? <button onClick={() => setOpen((v) => !v)} className="font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ink">{open ? "fewer" : "all"}</button> : null}
      </div>
      {err ? <p className="mt-2 text-[12px] text-tomato">{err}</p> : null}
      <ul className="mt-3 divide-y divide-line-soft">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-[10rem] flex-1 font-serif text-[15px] text-ink">{p.canonical_name} <span className="font-mono text-[10px] uppercase text-clay">{p.uses ? `· ${p.uses} lines` : ""}</span></span>
            <span className="font-mono text-[12px] tabular-nums text-[#B27A08]">{eur(p.price_eur)} / {p.unit}</span>
            <input inputMode="decimal" placeholder="real price" value={edit[p.id] ?? ""} onChange={(e) => setEdit((x) => ({ ...x, [p.id]: e.target.value }))}
              className="w-24 rounded-md border border-line px-2 py-1 font-mono text-[12px] tabular-nums" />
            <button disabled={busy === p.id} onClick={() => confirm(p.id, edit[p.id])} className="rounded-md border border-ink px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-ink hover:text-white disabled:opacity-50">
              {edit[p.id]?.trim() ? "Set" : "Keep"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
