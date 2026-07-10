"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

// Kitchen anomaly tile — reads finance_anomalies rows of kind eod_cash_ratio_high for
// the current entity. Surfaces the "cash > 15% of gross" case straight on the pass so
// it never lives only in the finance corner of the OS. Rule: memory/pos_vs_accounting_separation.md.
const ENTITY_TO_CODE: Record<EntityKey, "IFL"|"BM"|"BBH"> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };

// Kitchen dashboard tiles — comp %, staff-meal %, waste % — the leading indicators the team
// sees every service. Reads from v_operational_pnl (POS snapshot minus categorised deviations).
// Rule: memory/pos_vs_accounting_separation.md.

type Row = {
  date: string;
  comp_pct: number;
  staff_meal_pct: number;
  waste_pct: number;
  total_gross_eur: number;
  comp_eur: number; staff_meal_eur: number; waste_eur: number;
};

const pct = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(1) + "%";
const eur = (n: number) => "€" + Math.round(Number(n) || 0).toLocaleString("en-GB");

export default function KitchenPass() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [cashAnoms, setCashAnoms] = useState<Array<{ id: string; description: string; severity: number; last_seen_date: string }>>([]);

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  useEffect(() => {
    const rid = ENTITY_TO_RESTAURANT[entity] || ENTITY_TO_RESTAURANT.utopia!;
    (async () => {
      setLoading(true);
      const q = await supabaseBrowser.from("v_operational_pnl")
        .select("date,comp_pct,staff_meal_pct,waste_pct,total_gross_eur,comp_eur,staff_meal_eur,waste_eur")
        .eq("restaurant_id", rid)
        .order("date", { ascending: false })
        .limit(30);
      setRows((q.data as any) || []);
      setLoading(false);
    })();
    (async () => {
      const code = ENTITY_TO_CODE[entity];
      const a = await supabaseBrowser.from("v_finance_anomalies_open")
        .select("id,description,severity,last_seen_date")
        .eq("entity_code", code)
        .eq("kind", "eod_cash_ratio_high")
        .order("last_seen_date", { ascending: false })
        .limit(5);
      setCashAnoms(((a.data as any) || []));
    })();
  }, [entity]);

  const today = rows[0];
  // Rolling 30-day averages
  const avg = (k: keyof Row) => rows.length ? +(rows.reduce((a, r) => a + Number(r[k] || 0), 0) / rows.length).toFixed(2) : 0;

  const Tile = ({ label, todayVal, avgVal, sub }: { label: string; todayVal: string; avgVal: string; sub?: string }) => (
    <div className="border-t border-line pt-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-2 font-serif text-4xl text-ink">{todayVal}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">30-day avg {avgVal}</p>
      {sub ? <p className="mt-2 font-serif italic text-[13px] text-ink-soft">{sub}</p> : null}
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Kitchen pass · leading indicators</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">Food that left the kitchen.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Comps, staff meals, waste. If POS revenue doesn't reflect them, food-cost % lies. These tiles show the truth from the operational P&L.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <Tile label="Comp %"
          todayVal={loading ? "—" : pct(today?.comp_pct || 0)}
          avgVal={loading ? "—" : pct(avg("comp_pct"))}
          sub={today ? `${eur(today.comp_eur)} today` : undefined} />
        <Tile label="Staff-meal %"
          todayVal={loading ? "—" : pct(today?.staff_meal_pct || 0)}
          avgVal={loading ? "—" : pct(avg("staff_meal_pct"))}
          sub={today ? `${eur(today.staff_meal_eur)} today` : undefined} />
        <Tile label="Waste %"
          todayVal={loading ? "—" : pct(today?.waste_pct || 0)}
          avgVal={loading ? "—" : pct(avg("waste_pct"))}
          sub={today ? `${eur(today.waste_eur)} today` : undefined} />
      </div>

      <section className="mt-10 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Cash-ratio anomalies</p>
        {cashAnoms.length === 0 ? (
          <p className="mt-3 font-serif italic text-[13px] text-ink-soft">Nothing to flag. Cash stayed under 15% of gross on every recent service.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {cashAnoms.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between py-2">
                <span className="font-mono text-[11px] text-clay">{a.last_seen_date}</span>
                <span className="font-serif italic text-[12px] text-ink-soft ml-3 flex-1">{a.description}</span>
                <Link href="/administrate/finance/anomalies" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Triage →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Last 14 days</p>
        {loading ? <p className="mt-3 font-serif italic text-[13px] text-ink-soft">Loading…</p> : null}
        {!loading && !rows.length ? <p className="mt-3 font-serif italic text-[13px] text-ink-soft">No POS data yet. Upload today's Fresto export from EOD.</p> : null}
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {rows.slice(0, 14).map((r) => (
            <li key={r.date} className="flex items-baseline justify-between py-2">
              <span className="font-mono text-[11px] text-clay">{r.date}</span>
              <span className="font-mono text-[12px] text-ink-soft">
                comp {pct(r.comp_pct)} · staff {pct(r.staff_meal_pct)} · waste {pct(r.waste_pct)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
