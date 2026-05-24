import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const UT = "a0000000-0000-4000-8000-000000000001";
const eur = (n: number) => "€" + n.toFixed(2);

const CLASS: Record<string, { label: string; note: string; color: string }> = {
  star: { label: "Star", note: "Sells well and pays well — protect it, put it front and centre.", color: "text-olive" },
  plow: { label: "Plowhorse", note: "A favourite, but the margin is thin — trim the cost or gently lift the price.", color: "text-ochre" },
  puzzle: { label: "Puzzle", note: "Makes good money but few order it — promote it, move it up the menu, get staff selling it.", color: "text-tomato" },
  dog: { label: "Dog", note: "Low margin and slow — rework the dish, or retire it for something that earns.", color: "text-clay" },
};

export default async function MenuEngineering() {
  const dishes = (await supabase.from("menu_items").select("id,name,price,cost,units_sold").eq("restaurant_id", UT).not("units_sold", "is", null)).data || [];
  const rows = dishes.map((d: any) => {
    const price = Number(d.price || 0), cost = Number(d.cost || 0), units = Number(d.units_sold || 0);
    const marginEur = price - cost;
    const marginPct = price ? Math.round((marginEur / price) * 1000) / 10 : 0;
    return { id: d.id, name: d.name, price, cost, units, marginEur, marginPct, contribution: marginEur * units };
  });
  const avgMargin = rows.reduce((a, r) => a + r.marginEur, 0) / (rows.length || 1);
  const avgUnits = rows.reduce((a, r) => a + r.units, 0) / (rows.length || 1);
  const cls = (r: any) => {
    const hiM = r.marginEur >= avgMargin, hiP = r.units >= avgUnits;
    return hiM && hiP ? "star" : !hiM && hiP ? "plow" : hiM && !hiP ? "puzzle" : "dog";
  };
  const ranked = rows.map((r) => ({ ...r, k: cls(r) })).sort((a, b) => b.contribution - a.contribution);
  const totalContribution = rows.reduce((a, r) => a + r.contribution, 0);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/trial" className="font-sans text-sm text-ink-soft">← Restaurant Utopia</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Menu engineering</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What earns its place</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">Every dish placed by margin against popularity. Stars carry the menu; plowhorses sell but barely pay; puzzles are worth promoting; dogs are candidates to rework or cut.</p>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Total contribution · period</p>
        <p className="mt-1 font-serif text-4xl text-ink">{eur(totalContribution)}</p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">Avg margin {eur(avgMargin)} · avg {Math.round(avgUnits)} sold. Top earner: {ranked[0] ? noEmoji(ranked[0].name) : "—"}.</p>
      </div>

      <div className="mt-4 rounded-2xl border border-tomato/30 bg-card p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-tomato">Where the money actually is</p>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">Margin % isn't the whole story — a pricier dish at a lower % can earn more in absolute euros. Biggest earners this period:</p>
        <ul className="mt-2">
          {ranked.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-1 font-mono text-[12.5px]">
              <span className="text-ink">{i + 1}. {noEmoji(r.name)}</span>
              <span className="text-ink-soft">{eur(r.contribution)} · {r.marginPct}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-sans text-[12px] text-clay">Worth protecting and pushing even when the margin % isn't the highest — sometimes you bite the margin for the bigger euro.</p>
      </div>

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {ranked.map((r) => (
          <li key={r.id} className="py-3">
            <Link href={"/menu/" + r.id} className="block transition hover:opacity-70">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-serif text-[18px] text-ink">{noEmoji(r.name)}</span>
                <span className={"font-mono text-[11px] uppercase tracking-wide " + CLASS[r.k].color}>{CLASS[r.k].label}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-clay">{r.units} sold · {eur(r.marginEur)} margin ({r.marginPct}%) · {eur(r.contribution)} total</p>
              <p className="mt-0.5 font-sans text-[12px] text-ink-soft">{CLASS[r.k].note}</p>
            </Link>
          </li>
        ))}
        {!ranked.length ? <p className="py-3 font-sans text-[14px] text-clay">No dishes with sales data yet.</p> : null}
      </ul>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Trial data · runs per venue once costs + POS sales are loaded</p>
    </main>
  );
}
