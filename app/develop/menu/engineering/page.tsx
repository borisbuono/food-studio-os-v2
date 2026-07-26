import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { classifyEngineering, type EngineeringRow } from "@/lib/recipes/calculation";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + n.toFixed(2);

// Menu engineering matrix (Kasavana & Smith / Boston-matrix). Precision face:
// hairlines, tabular-nums, quadrant chips. Every row drills into the full
// Calculation view for that dish.

const QUAD = {
  star:   { label: "Stars",       note: "Sell well and pay well — protect them, put them front-of-menu.",              tone: "text-basil" },
  plow:   { label: "Plowhorses",  note: "A favourite, but the margin is thin — trim cost or nudge the price.",         tone: "text-ink-soft" },
  puzzle: { label: "Puzzles",     note: "Great margin, few orders — reposition, retrain servers, feature it.",         tone: "text-tomato" },
  dog:    { label: "Dogs",        note: "Low margin and slow — rework the dish, or retire it for something that earns.", tone: "text-clay" },
} as const;

export default async function MenuEngineeringMatrix() {
  const supabase = supabaseServer();

  // Read menu_items with a recipe_id + price + units_sold. We prefer the
  // computed cost_per_serving_eur on recipes; fall back to menu_items.cost.
  const items: any[] = ((await supabase
    .from("menu_items")
    .select("id,name,price,cost,units_sold,recipe_id,is_active")
    .eq("is_active", true)
    .not("price", "is", null)
    .not("units_sold", "is", null)
  ).data) || [];

  let costsByRecipe: Record<string, number> = {};
  const rids = items.map((i) => i.recipe_id).filter(Boolean);
  if (rids.length) {
    const recs: any[] = ((await supabase.from("recipes").select("id,cost_per_serving_eur").in("id", rids)).data) || [];
    for (const r of recs) if (r.cost_per_serving_eur != null) costsByRecipe[r.id] = Number(r.cost_per_serving_eur);
  }

  const rows: EngineeringRow[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    menu_price: Number(it.price || 0),
    cost_per_serving: costsByRecipe[it.recipe_id] ?? Number(it.cost || 0),
    units_sold: Number(it.units_sold || 0),
  })).filter((r) => r.menu_price > 0);

  const classified = classifyEngineering(rows).sort((a, b) => b.contribution - a.contribution);
  const totalContribution = classified.reduce((s, r) => s + r.contribution, 0);
  const byQuad: Record<string, typeof classified> = { star: [], plow: [], puzzle: [], dog: [] };
  for (const r of classified) byQuad[r.klass].push(r);

  const nameById = new Map(items.map((i) => [i.id, i.name] as const));

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-7 py-14 bg-paper">
      <Link href="/develop/recipes" className="font-sans text-[13px] text-ink-soft">← The corpus</Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">Menu engineering</p>
      <h1 className="mt-2 font-serif text-5xl font-light leading-tight text-ink">What earns its place</h1>
      <p className="mt-3 max-w-xl lg:max-w-4xl font-serif text-[18px] font-light italic leading-snug text-ink-soft">
        Every dish placed by contribution margin against popularity. Stars carry the menu; plowhorses sell but barely pay; puzzles are worth promoting; dogs are candidates to rework or cut.
      </p>

      {!classified.length ? (
        <div className="mt-12 border border-dashed border-line px-8 py-14 text-center">
          <p className="font-serif text-[21px] font-light italic text-ink-soft">No sold-with-price data yet.</p>
          <p className="mt-2 font-sans text-[13px] text-clay">Once a POS import lands and prices are set, the matrix populates.</p>
        </div>
      ) : (
        <>
          <div className="mt-10 border-y border-line py-6">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Total contribution · period</p>
            <p className="mt-2 font-serif text-[48px] font-light tabular-nums text-ink">{eur(totalContribution)}</p>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">Top earner: {classified[0] ? noEmoji(nameById.get(classified[0].id) || classified[0].name) : "—"}.</p>
          </div>

          {/* The 2x2 matrix */}
          <section className="mt-10">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">The matrix</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {(["star","puzzle","plow","dog"] as const).map((k) => (
                <div key={k} className="border border-line bg-card p-5">
                  <p className={"font-mono text-[10.5px] uppercase tracking-[0.24em] " + QUAD[k].tone}>{QUAD[k].label}</p>
                  <p className="mt-1 font-sans text-[12px] leading-snug text-ink-soft">{QUAD[k].note}</p>
                  <ul className="mt-4 divide-y divide-line-soft">
                    {byQuad[k].map((r) => (
                      <li key={r.id}>
                        <Link href={`/develop/menu/${(items.find((i) => i.id === r.id) || {}).recipe_id || r.id}/calculation`} className="flex items-baseline justify-between gap-3 py-2 transition hover:opacity-70">
                          <span className="font-serif text-[16px] text-ink">{noEmoji(r.name)}</span>
                          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-clay tabular-nums">
                            {eur(r.margin)} · {r.units_sold}×
                          </span>
                        </Link>
                      </li>
                    ))}
                    {!byQuad[k].length ? <li className="py-2 font-serif text-[14px] italic text-ink-soft">Nothing here yet.</li> : null}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Ranked table for detail */}
          <section className="mt-12 border-t border-line pt-8">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Ranked by contribution</p>
            <table className="mt-4 w-full border-collapse font-sans text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">
                  <th className="py-2 pr-3 font-normal">Dish</th>
                  <th className="py-2 pr-3 text-right font-normal">Price</th>
                  <th className="py-2 pr-3 text-right font-normal">Cost</th>
                  <th className="py-2 pr-3 text-right font-normal">Margin</th>
                  <th className="py-2 pr-3 text-right font-normal">Sold</th>
                  <th className="py-2 text-right font-normal">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {classified.map((r) => {
                  const item = items.find((i) => i.id === r.id);
                  const link = item?.recipe_id ? `/develop/menu/${item.recipe_id}/calculation` : `/menu/${r.id}`;
                  return (
                    <tr key={r.id} className="border-b border-line-soft">
                      <td className="py-2 pr-3 text-ink">
                        <Link href={link} className="hover:opacity-70">{noEmoji(r.name)}</Link>
                        <span className={"ml-3 font-mono text-[10px] uppercase tracking-[0.14em] " + QUAD[r.klass].tone}>{QUAD[r.klass].label.slice(0, -1)}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-soft">{eur(r.menu_price)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-soft">{eur(r.cost_per_serving)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink">{eur(r.margin)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-soft">{r.units_sold}</td>
                      <td className="py-2 text-right tabular-nums text-ink">{eur(r.contribution)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
