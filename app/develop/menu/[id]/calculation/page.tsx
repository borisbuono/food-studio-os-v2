import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import {
  costRecipe, calcCostPerServing, suggestedPrice, foodCostPercent, overTargetAlert,
  normalizeName, type InventoryLookup, type NameLookup,
} from "@/lib/recipes/calculation";

export const dynamic = "force-dynamic";
const eur = (n: number | null) => (n == null ? "—" : "€" + n.toFixed(2));

// Full Calculation view for a single dish. Precision face: hairlines,
// tabular-nums, no illustrative flourishes. The chef reads this to decide
// pricing; the accountant reads it during variance review.
export default async function CalculationPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const recipe: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!recipe) {
    return (
      <main className="mx-auto max-w-2xl px-7 py-16 bg-paper">
        <Link href="/develop/recipes" className="font-sans text-[13px] text-ink-soft">← The corpus</Link>
        <p className="mt-10 font-serif text-[28px] font-light italic text-ink-soft">Recipe not found.</p>
      </main>
    );
  }

  const menuItem: any = (await supabase.from("menu_items").select("id,name,price,target_food_cost_percent,units_sold").eq("recipe_id", recipe.id).maybeSingle()).data;
  const rows: any[] = ((await supabase.from("recipe_ingredients").select("id,ingredient_name,name,quantity,unit,line_cost,ingredient_id,is_optional,sort_order,order_idx").eq("recipe_id", recipe.id).order("order_idx", { ascending: true })).data) || [];

  const ingIds = rows.map((r) => r.ingredient_id).filter(Boolean);
  const inv: any[] = ingIds.length
    ? ((await supabase.from("inventory_items").select("id,name,unit,unit_cost").in("id", ingIds)).data) || []
    : [];
  const inventory: InventoryLookup = Object.fromEntries(inv.map((i) => [i.id, { unit_cost: i.unit_cost, unit: i.unit, name: i.name }]));

  // Name-based fallback: pull inventory in the same venue and index by normalized name.
  const allInv: any[] = ((await supabase.from("inventory_items").select("name,unit_cost").limit(2000)).data) || [];
  const byName: NameLookup = {};
  for (const it of allInv) {
    if (it?.name && it.unit_cost != null) byName[normalizeName(it.name)] = Number(it.unit_cost);
  }

  const costed = costRecipe(rows, inventory, byName);
  const cps = calcCostPerServing(costed.total, recipe.servings);
  const target = menuItem?.target_food_cost_percent ?? 30;
  const suggested = suggestedPrice(cps, target);
  const actualPct = foodCostPercent(cps, menuItem?.price ?? null);
  const alert = overTargetAlert(actualPct, target);

  return (
    <main className="mx-auto max-w-3xl px-7 py-14 bg-paper">
      <Link href={`/develop/menu/${recipe.id}`} className="font-sans text-[13px] text-ink-soft">← {noEmoji(recipe.name)}</Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">Calculation</p>
      <h1 className="mt-2 font-serif text-4xl font-light leading-tight text-ink">{noEmoji(recipe.name)}</h1>

      {alert ? (
        <div className="mt-6 border-l-2 border-tomato bg-paper-deep px-4 py-3">
          <p className="font-sans text-[13px] text-tomato">
            Food cost {actualPct?.toFixed(1)}% is above target {Number(target).toFixed(0)}% by more than 5 pts — review the recipe or reprice.
          </p>
        </div>
      ) : null}

      {/* --- Ingredient breakdown --- */}
      <section className="mt-10 border-t border-line pt-8">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Ingredient breakdown</p>
        <table className="mt-4 w-full border-collapse font-sans text-[13px]">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">
              <th className="py-2 pr-3 font-normal">Ingredient</th>
              <th className="py-2 pr-3 text-right font-normal">Qty</th>
              <th className="py-2 pr-3 text-right font-normal">Unit</th>
              <th className="py-2 pr-3 text-right font-normal">Unit cost</th>
              <th className="py-2 text-right font-normal">Line cost</th>
            </tr>
          </thead>
          <tbody>
            {costed.lines.map(({ row, line_cost }, idx) => {
              const invRow = row.ingredient_id ? inventory[row.ingredient_id] : null;
              const unitCost = invRow?.unit_cost ?? (row.quantity && line_cost != null ? line_cost / Number(row.quantity) : null);
              return (
                <tr key={idx} className="border-b border-line-soft">
                  <td className="py-2 pr-3 text-ink">
                    {noEmoji(String(row.ingredient_name || row.name || ""))}
                    {row.is_optional ? <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-clay">optional</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-soft">{row.quantity ?? "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[11px] uppercase tracking-wide text-clay">{row.unit || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-soft">{unitCost != null ? eur(Number(unitCost)) : "—"}</td>
                  <td className={"py-2 text-right tabular-nums " + (line_cost == null ? "text-clay" : "text-ink")}>{line_cost != null ? eur(line_cost) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 pr-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">
                Total · {costed.priced} priced, {costed.missing} without cost
              </td>
              <td></td><td></td><td></td>
              <td className="pt-4 text-right font-serif text-[22px] tabular-nums text-ink">{eur(costed.total)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* --- Big number --- */}
      <section className="mt-10 border-t border-line pt-8">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Cost per serving</p>
        <p className="mt-2 font-serif text-[64px] font-light leading-none text-ink tabular-nums">{eur(cps)}</p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">Across {recipe.servings ?? "—"} serving{recipe.servings === 1 ? "" : "s"}.</p>
      </section>

      {/* --- Pricing --- */}
      <section className="mt-10 border-t border-line pt-8">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Pricing</p>
        <div className="mt-4 grid grid-cols-3 gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">On the menu</p>
            <p className="mt-1 font-serif text-[28px] tabular-nums text-ink">{eur(menuItem?.price ?? null)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Suggested at {Number(target).toFixed(0)}%</p>
            <p className="mt-1 font-serif text-[28px] tabular-nums text-basil">{eur(suggested)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Food cost actual</p>
            <p className={"mt-1 font-serif text-[28px] tabular-nums " + (alert ? "text-tomato" : "text-ink")}>
              {actualPct == null ? "—" : actualPct.toFixed(1) + "%"}
            </p>
          </div>
        </div>
        {menuItem?.units_sold != null ? (
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">
            Contribution this period · {eur((menuItem.price ?? 0) - (cps ?? 0))} × {menuItem.units_sold} sold =
            <span className="ml-2 text-ink tabular-nums">{eur(((menuItem.price ?? 0) - (cps ?? 0)) * menuItem.units_sold)}</span>
          </p>
        ) : null}
      </section>
    </main>
  );
}
