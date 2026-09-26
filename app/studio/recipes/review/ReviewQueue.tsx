"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MiniMarkdown } from "@/lib/recipes/miniMarkdown";
import { decideRecipes, type ReviewAction } from "./actions";

export type ReviewCard = {
  id: string; name: string; category: string | null; cuisine: string | null; difficulty: number | null;
  prep_minutes: number | null; cook_minutes: number | null; yield_qty: number | null; yield_unit: string | null;
  servings: number | null; tagline: string | null; story: string | null; method: string | null;
  public_slug: string | null; allergens: string[]; public_candidate: boolean; drafted_by: string | null;
  ingredients: { name: string; quantity: string | null; unit: string | null; notes: string | null }[];
};

const LABEL: Record<ReviewAction, string> = {
  approve: "Approve & publish", approve_private: "Approve (kitchen only)", discard: "Discard", unpublish: "Unpublish",
};

export default function ReviewQueue({ cards }: { cards: ReviewCard[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = cards.length > 0 && cards.every((c) => sel.has(c.id));
  const run = (ids: string[], action: ReviewAction) => {
    if (!ids.length) return;
    if (action === "discard" && !window.confirm(`Discard ${ids.length} recipe${ids.length === 1 ? "" : "s"}? They are archived in both kitchens.`)) return;
    setMsg(null);
    start(async () => {
      const r = await decideRecipes(ids, action);
      setMsg(r.ok ? `${LABEL[action]}: ${r.n} done.` : `Failed: ${r.error}`);
      if (r.ok) setSel(new Set());
    });
  };

  if (!cards.length) {
    return <p className="mt-12 font-serif text-[19px] italic text-ink-soft">Nothing waiting here.</p>;
  }

  return (
    <section className="mt-6">
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 border-b border-line bg-paper/95 px-2 py-3 backdrop-blur">
        <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft">
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(cards.map((c) => c.id)))} />
          Select page ({cards.length})
        </label>
        <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{sel.size} selected</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {(["approve", "approve_private", "discard"] as ReviewAction[]).map((a) => (
            <button key={a} disabled={!sel.size || pending} onClick={() => run(Array.from(sel), a)}
              className={`rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wide disabled:opacity-40 ${a === "approve" ? "bg-ink text-paper" : a === "discard" ? "border border-tomato/50 text-tomato" : "border border-line text-ink"}`}>
              {LABEL[a]}{sel.size ? ` (${sel.size})` : ""}
            </button>
          ))}
        </div>
        {msg ? <p className="w-full font-sans text-[12px] text-ink-soft">{pending ? "Working…" : msg}</p> : null}
      </div>

      <ul className="mt-4 space-y-4">
        {cards.map((c) => (
          <li key={c.id} className={`rounded-md border bg-white p-4 ${sel.has(c.id) ? "border-ink" : "border-line"}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-2" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                  {[c.category?.replace(/-/g, " "), c.cuisine, c.difficulty ? `difficulty ${c.difficulty}/5` : null,
                    c.prep_minutes != null ? `prep ${c.prep_minutes}′` : null, c.cook_minutes ? `cook ${c.cook_minutes}′` : null,
                    c.yield_qty != null ? `yield ${Number(c.yield_qty)} ${c.yield_unit || ""}` : null].filter(Boolean).join(" · ")}
                </p>
                <h2 className="mt-1 font-serif text-[22px] leading-tight text-ink">{c.name}</h2>
                {c.tagline ? <p className="font-serif text-[15px] italic text-ink-soft">{c.tagline}</p> : null}
                {c.story ? <p className="mt-2 max-w-3xl font-sans text-[13px] text-ink-soft">{c.story}</p> : null}
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                  {c.public_candidate && c.public_slug ? `public on approve → /recipes/${c.public_slug}` : "kitchen only"}
                  {c.allergens.length ? ` · allergens: ${c.allergens.join(", ")}` : ""}
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-tomato">
                    Ingredients ({c.ingredients.length}) &amp; method
                  </summary>
                  <div className="mt-3 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <ul className="divide-y divide-line text-[13px]">
                      {c.ingredients.map((i, k) => (
                        <li key={k} className="flex justify-between gap-3 py-1">
                          <span>{i.name}{i.notes ? <span className="text-clay"> · {i.notes}</span> : null}</span>
                          <span className="shrink-0 tabular-nums text-ink-soft">{[i.quantity, i.unit].filter(Boolean).join(" ")}</span>
                        </li>
                      ))}
                    </ul>
                    <MiniMarkdown source={c.method} className="text-[13px] leading-relaxed" />
                  </div>
                </details>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button disabled={pending} onClick={() => run([c.id], "approve")} className="rounded-md bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">Approve</button>
                <Link href={`/h/bm/menu/recipes/${c.id}`} className="rounded-md border border-line px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-wide">Edit</Link>
                <button disabled={pending} onClick={() => run([c.id], "discard")} className="rounded-md border border-tomato/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-tomato disabled:opacity-40">Discard</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
