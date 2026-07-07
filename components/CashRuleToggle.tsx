"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Per-restaurant cash-deduction toggle. Renders under "Fiscal" on the entity
// setup page. Writes restaurants.deduct_pos_cash_from_food. Rule LOCKED
// 2026-07-07 — see supabase/migrations/20260707_restaurant_cash_rule.sql +
// memory/eod_posting_cash_deduction_rule.md.
export default function CashRuleToggle({ restaurant_id, restaurant_label }: { restaurant_id: string; restaurant_label: string }) {
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = await supabaseBrowser
        .from("restaurants")
        .select("deduct_pos_cash_from_food")
        .eq("id", restaurant_id)
        .maybeSingle();
      if (cancelled) return;
      if (q.error) { setErr(q.error.message); return; }
      const v = q.data?.deduct_pos_cash_from_food;
      // Undefined = column missing (pre-migration) — assume TRUE to match default.
      setValue(v === false ? false : true);
    })();
    return () => { cancelled = true; };
  }, [restaurant_id]);

  const flip = async (next: boolean) => {
    setBusy(true); setErr("");
    const r = await supabaseBrowser
      .from("restaurants")
      .update({ deduct_pos_cash_from_food: next })
      .eq("id", restaurant_id);
    if (r.error) { setErr(r.error.message); setBusy(false); return; }
    setValue(next);
    setSavedAt(new Date());
    setBusy(false);
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <label className="flex items-baseline gap-2">
        <input
          type="checkbox"
          disabled={value === null || busy}
          checked={value === true}
          onChange={(e) => flip(e.target.checked)}
          aria-label="Deduct Fresto Cash line from Food revenue"
        />
        <span className="font-serif text-[14px] text-ink">
          Deduct Fresto Cash line from Food revenue
          <span
            title={
              "House rule: the Fresto POS Cash line is orphan cash — EOD counting mistakes " +
              "that Fresto defaults into Food at ring-up. Real Food = Food − Cash. Turn this " +
              "OFF only for venues with real till service (advisory clients, cash-heavy operations)."
            }
            className="ml-2 cursor-help border border-line px-1 font-mono text-[9px] uppercase tracking-wide text-clay"
          >
            ?
          </span>
        </span>
      </label>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
        {restaurant_label} · {value === null ? "loading…" : value ? "on" : "off"}
        {savedAt ? " · saved " + savedAt.toLocaleTimeString("en-GB") : ""}
      </p>
      {err ? <p className="mt-1 font-mono text-[11px] text-tomato">⚠ {err}</p> : null}
    </div>
  );
}
