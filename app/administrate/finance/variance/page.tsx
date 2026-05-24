import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const UT = "a0000000-0000-4000-8000-000000000001";
const eur = (n: number) => (n < 0 ? "-€" : "€") + Math.abs(n).toFixed(2);

export default async function Variance() {
  const items = (await supabase.from("inventory_items").select("id,name,unit,unit_cost,quantity_on_hand").eq("restaurant_id", UT)).data || [];
  const ids = items.map((i: any) => i.id);
  const moves = ids.length ? (await supabase.from("inventory_movements").select("inventory_item_id,quantity").in("inventory_item_id", ids)).data || [] : [];
  const theoBy: Record<string, number> = {};
  moves.forEach((m: any) => { theoBy[m.inventory_item_id] = (theoBy[m.inventory_item_id] || 0) + Number(m.quantity || 0); });

  const rows = items.map((i: any) => {
    const theo = theoBy[i.id] || 0;
    const actual = Number(i.quantity_on_hand || 0);
    const varUnits = theo - actual; // positive = stock missing vs. what sales say should be there
    const varEur = varUnits * Number(i.unit_cost || 0);
    return { name: i.name, unit: i.unit, theo, actual, varUnits, varEur };
  }).sort((a, b) => Math.abs(b.varEur) - Math.abs(a.varEur));

  const totalLoss = rows.filter((r) => r.varEur > 0).reduce((a, r) => a + r.varEur, 0);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/trial" className="font-sans text-sm text-ink-soft">← Restaurant Utopia</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Variance · theoretical vs. actual</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Where the stock went</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">Theoretical = opening stock minus what the recipes say sales should have used. Actual = the counted stock. The gap is waste, over-portioning or shrinkage — in euros.</p>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Unaccounted this period</p>
        <p className="mt-1 font-serif text-4xl text-ember">{eur(totalLoss)}</p>
      </div>

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-3">
            <div>
              <p className="font-serif text-[17px] text-ink">{noEmoji(r.name)}</p>
              <p className="font-mono text-[11px] text-clay">theo {Math.round(r.theo)} · actual {Math.round(r.actual)} {r.unit}</p>
            </div>
            <span className={"font-mono text-[13px] " + (r.varEur > 0.5 ? "text-ember" : r.varEur < -0.5 ? "text-olive" : "text-clay")}>{Math.abs(r.varEur) < 0.005 ? "ok" : eur(r.varEur)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Trial data · once POS + counts flow for a real venue, this runs on its own</p>
    </main>
  );
}
