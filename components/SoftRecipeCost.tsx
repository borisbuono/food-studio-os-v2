"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const BASES = [
  { k: "piece", label: "per piece" }, { k: "portion", label: "per portion" },
  { k: "g", label: "per gram" }, { k: "100g", label: "per 100g" }, { k: "ml", label: "per ml" }, { k: "kg", label: "per kg" }, { k: "l", label: "per litre" },
];

// A "soft recipe" — a buy-and-sell item (an oyster, a piece of fish) that isn't a
// full multi-step recipe but is still costed. Set what you pay, see the margin. Editable, signed-in.
export default function SoftRecipeCost({ id, initialCost, initialBasis, price }: { id: string; initialCost: number | null; initialBasis: string | null; price: number | null }) {
  const [cost, setCost] = useState<string>(initialCost != null ? String(initialCost) : "");
  const [basis, setBasis] = useState<string>(initialBasis || "piece");
  const [edit, setEdit] = useState<boolean>(initialCost == null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const c = parseFloat(cost);
  const p = price ?? null;
  const fp = p && c ? Math.round((c / p) * 1000) / 10 : null;
  const marg = p != null && !isNaN(c) ? p - c : null;
  const fpColor = fp == null ? "#9B8E7E" : fp <= 32 ? "#5A6B3B" : fp <= 45 ? "#B5701C" : "#B8552E";

  const save = async () => {
    setSaving(true); setErr("");
    const { error } = await supabaseBrowser.from("menu_items").update({ cost: isNaN(c) ? null : c, cost_basis: basis }).eq("id", id);
    if (error) setErr("Sign in to save — this is a preview."); else setEdit(false);
    setSaving(false);
  };

  return (
    <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
      <p className="font-sans text-xs font-medium text-ink-soft">Calculation · buy &amp; sell</p>
      {edit ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Cost €</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="2.50" className="mt-1 w-24 rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink outline-none focus:border-ink" />
          </label>
          <label className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Basis</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value)} className="mt-1 rounded-lg border border-black/15 bg-paper px-2 py-2 font-sans text-[14px] text-ink">{BASES.map((b) => <option key={b.k} value={b.k}>{b.label}</option>)}</select>
          </label>
          <button onClick={save} disabled={saving} className="rounded-xl px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>{saving ? "Saving…" : "Save cost"}</button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div><p className="font-serif text-xl text-ink">€{(isNaN(c) ? 0 : c).toFixed(2)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Cost · {BASES.find((b) => b.k === basis)?.label || basis}</p></div>
          <div><p className="font-serif text-xl" style={{ color: fpColor }}>{fp != null ? fp + "%" : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Food cost</p></div>
          <div><p className="font-serif text-xl text-ink">{marg != null ? "€" + marg.toFixed(2) : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Margin</p></div>
        </div>
      )}
      {err ? <p className="mt-2 font-mono text-[11px] text-ink-soft">{err}</p> : null}
      {!edit ? <button onClick={() => setEdit(true)} className="mt-3 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>edit cost</button> : null}
      <p className="mt-3 font-sans text-[12px] leading-relaxed text-clay">A buy-and-sell dish — no full recipe, but still costed. Price comes from the menu; cost from the delivery note.</p>
    </div>
  );
}
