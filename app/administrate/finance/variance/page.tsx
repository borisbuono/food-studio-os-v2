import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const UT = "a0000000-0000-4000-8000-000000000001";
const eur = (n: number) => (n < 0 ? "-€" : "€") + Math.abs(n).toFixed(2);

export default async function Variance() {
  const items = (await supabase.from("inventory_items").select("name,unit,unit_cost,quantity_on_hand,counted_qty").eq("restaurant_id", UT)).data || [];
  const rows = items
    .filter((i: any) => i.counted_qty != null)
    .map((i: any) => {
      const book = Number(i.quantity_on_hand || 0);
      const counted = Number(i.counted_qty || 0);
      const varUnits = book - counted;       // + = stock missing vs. what sales imply
      const varEur = varUnits * Number(i.unit_cost || 0);
      return { name: i.name, unit: i.unit, book, counted, varUnits, varEur };
    })
    .sort((a, b) => Math.abs(b.varEur) - Math.abs(a.varEur));
  const totalLoss = rows.filter((r) => r.varEur > 0).reduce((a, r) => a + r.varEur, 0);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/trial" className="font-sans text-sm text-ink-soft">← Restaurant Utopia</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Variance · theoretical vs. actual</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Where the stock went</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">Book = opening stock minus what the recipes say the day’s sales should have used. Counted = the physical stock-take. The gap is waste, over-portioning or shrinkage — priced out.</p>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Unaccounted this period</p>
        <p className="mt-1 font-serif text-4xl text-ember">{eur(totalLoss)}</p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">Across {rows.length} tracked ingredients. Biggest leak: {rows[0] ? noEmoji(rows[0].name) : "—"}.</p>
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-black/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ochre">Academy · what to aim for</p>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">A healthy kitchen runs variance near zero. A point or two is normal shrink — but a steady gap on one pricey line (here, the iberico) is usually over-portioning, waste, or stock walking out the door. Chase the biggest euro first, fix the cause, recount next week, and watch it close. That habit is worth more than any single report.</p>
      </div>

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-3">
            <div>
              <p className="font-serif text-[17px] text-ink">{noEmoji(r.name)}</p>
              <p className="font-mono text-[11px] text-clay">book {Math.round(r.book)} · counted {Math.round(r.counted)} {r.unit}</p>
            </div>
            <span className={"font-mono text-[13px] " + (r.varEur > 0.5 ? "text-ember" : r.varEur < -0.5 ? "text-olive" : "text-clay")}>{Math.abs(r.varEur) < 0.005 ? "ok" : eur(r.varEur)}</span>
          </li>
        ))}
        {!rows.length ? <p className="py-3 font-sans text-[14px] text-clay">No counted stock yet.</p> : null}
      </ul>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Trial data · once POS sales + a stock count flow for a real venue, this runs on its own</p>
    </main>
  );
}
