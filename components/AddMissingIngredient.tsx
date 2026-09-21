"use client";

// Inline "add missing ingredient" for /studio/money/menu-margin.
// Boris fills recipes in as he meets them on the low-confidence rows:
// ingredient + quantity (+ optional "priced as" canonical so it links to
// an invoice price in the same move). Saves one line, recomputes the
// recipe, republishes the row, refreshes the page.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Canonical = { name: string; unit: string | null };

export default function AddMissingIngredient({
  recipeId,
  recipeName,
  yieldQty,
  datalistId,
  canonicals,
}: {
  recipeId: string;
  recipeName: string;
  yieldQty: number;
  datalistId: string;
  canonicals: Canonical[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [pricedAs, setPricedAs] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const lower = (s: string) => s.trim().toLowerCase();
  const exact = canonicals.find((c) => lower(c.name) === lower(name));
  const pricedCanon = canonicals.find((c) => lower(c.name) === lower(pricedAs));
  const hintUnit = (exact ?? pricedCanon)?.unit ?? null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/recipes/${recipeId}/ingredients`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ingredient_name: name,
          quantity: qty,
          unit: unit || hintUnit || null,
          priced_as: exact ? null : pricedAs || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ tone: "err", text: j.error || `failed (${r.status})` });
        return;
      }
      const st = j.line?.status;
      const cost = j.recipe?.cost_per_portion_eur;
      const head =
        st === "priced"
          ? `Saved · priced${j.line?.line_cost_eur != null ? ` €${Number(j.line.line_cost_eur).toFixed(2)}` : ""}`
          : st === "no_alias"
            ? "Saved · not linked to a purchase yet — pick “priced as”"
            : "Saved · linked, but no invoice price in the last 180 days";
      const tail = j.recipe
        ? ` · recipe ${j.recipe.priced_count}/${j.recipe.ingredient_count} priced, ${j.recipe.confidence}${cost != null ? `, €${Number(cost).toFixed(2)}/portion` : ""}`
        : j.recompute_error ? ` · recompute failed: ${j.recompute_error}` : "";
      setMsg({ tone: st === "priced" ? "ok" : "warn", text: head + tail });
      setName(""); setQty(""); setUnit(""); setPricedAs("");
      router.refresh();
    } catch (err: any) {
      setMsg({ tone: "err", text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded border border-black/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink/60"
      >
        + add ingredient
      </button>
    );
  }

  const input = "rounded border border-black/20 bg-white px-1.5 py-1 font-serif text-[12px] text-ink";
  return (
    <form onSubmit={save} className="mt-2 rounded border border-black/10 bg-white/70 p-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Add to {recipeName}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input
          className={input + " w-44"}
          list={datalistId}
          placeholder="ingredient"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <input
          className={input + " w-16 text-right"}
          inputMode="decimal"
          placeholder="qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
        <input
          className={input + " w-14"}
          placeholder={hintUnit ?? "unit"}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        {name.trim() && !exact && (
          <input
            className={input + " w-44"}
            list={datalistId}
            placeholder="priced as (invoice item)"
            value={pricedAs}
            onChange={(e) => setPricedAs(e.target.value)}
          />
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded border border-ink bg-ink px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-50"
        >
          {busy ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMsg(null); }}
          className="px-1 font-mono text-[10px] uppercase tracking-wide text-clay"
        >
          close
        </button>
      </div>
      <p className="mt-1 font-serif italic text-[11px] text-ink-soft">
        Quantity for the whole recipe ({yieldQty} {yieldQty === 1 ? "portion" : "portions"})
        {hintUnit ? `, in ${hintUnit}` : ", in the unit the invoice item is bought by"}.
      </p>
      {msg && (
        <p
          className={
            "mt-1 font-serif text-[11px] " +
            (msg.tone === "ok" ? "text-emerald-800" : msg.tone === "warn" ? "text-amber-800" : "text-red-700")
          }
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
