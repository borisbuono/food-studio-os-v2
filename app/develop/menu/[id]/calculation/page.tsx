import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
<<<<<<< HEAD
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
=======
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT } from "@/lib/entities";
import AssistantContext from "@/components/AssistantContext";
import CalculationBreakdown from "@/components/recipes/CalculationBreakdown";

export const dynamic = "force-dynamic";

// Precision face — the calculation view. Uses CalculationBreakdown. No serif
// prose here, just tabular-nums, hairlines, and a sticky summary card.
export default async function CalculationPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];

  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/develop/menu" className="font-sans text-sm text-ink-soft">← the repertoire</Link>
        <p className="mt-8 font-serif text-2xl text-ink">Recipe not found.</p>
      </main>
    );
  }
  const ings: any[] = (await supabase
    .from("recipe_ingredients")
    .select("name,quantity,unit,line_cost,sort_order,sub_recipe_id")
    .eq("recipe_id", r.id)
    .order("sort_order")).data || [];
  const dish: any = (await supabase.from("menu_items").select("id,price").eq("recipe_id", r.id).maybeSingle()).data;

  const portions = Number(r.portions) > 0 ? Number(r.portions) : null;
  const totalCost = r.cost_per_portion != null
    ? Number(r.cost_per_portion)
    : ings.reduce((a: number, i: any) => a + Number(i.line_cost || 0), 0);
  const menuPrice = dish?.price != null ? Number(dish.price) : (r.menu_price != null ? Number(r.menu_price) : null);
  const targetFcPct = r.target_food_cost_pct != null ? Number(r.target_food_cost_pct) : 28;

  const lines = ings.map((i: any) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    unit_cost: null,
    unit_cost_basis: null,
    line_cost: Number(i.line_cost || 0),
  }));

  const allergens: string[] = (r.allergens as string[]) || [];
  const dietary: string[] = (r.dietary as string[]) || [];

  return (
    <main className="mx-auto max-w-[1400px] bg-paper px-8 py-10" style={{ ["--fs-accent" as any]: accent }}>
      <AssistantContext context={{ kind: "calculation", id: r.id, name: r.name, entity, totalCost, menuPrice }} />
      <div className="mb-6 flex items-baseline justify-between">
        <Link href={`/develop/menu/${r.id}`} className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-ink">← back to the recipe</Link>
        <Link href={`/develop/menu/${r.id}/edit`} className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-ink">Edit →</Link>
      </div>
      <CalculationBreakdown
        title={noEmoji(r.name)}
        subtitle={portions ? `per portion, at ${portions} pax` : null}
        lines={lines}
        totalCost={totalCost}
        menuPrice={menuPrice}
        targetFcPct={targetFcPct}
        allergens={allergens}
        dietary={dietary}
        accent={accent}
      />
>>>>>>> Recipe v3 #2 — route wiring for detail/calculation/cook/list
    </main>
  );
}
