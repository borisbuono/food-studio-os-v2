import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const eur = (n: number) => (n < 0 ? "-€" : "€") + Math.abs(n).toFixed(2);

export default async function Variance({ searchParams }: { searchParams: { by?: string } }) {
  
  const supabase = supabaseServer();const by = (searchParams?.by === "recipe" ? "recipe" : "ingredient") as "recipe" | "ingredient";
  const rid = serverRestaurantId();

  // 1) raw ingredient variance from inventory book - count
  const items = (await supabase.from("inventory_items").select("id,name,unit,unit_cost,quantity_on_hand,counted_qty").eq("restaurant_id", rid)).data || [];
  const ingRows = items
    .filter((i: any) => i.counted_qty != null)
    .map((i: any) => {
      const book = Number(i.quantity_on_hand || 0);
      const counted = Number(i.counted_qty || 0);
      const varUnits = book - counted;
      const varEur = varUnits * Number(i.unit_cost || 0);
      return { id: i.id, name: i.name, unit: i.unit, book, counted, varUnits, varEur };
    });

  // 2) recipe-level variance: spread each ingredient's € variance across the recipes that consume it,
  //    weighted by how much each recipe's per-portion quantity × portions-sold contributes.
  // recipe_ingredients holds the per-portion quantity (mapped to inventory by name).
  const recipeRows: { id: string; name: string; varEur: number; topIng: string }[] = [];
  if (by === "recipe") {
    const recIngs = (await supabase.from("recipe_ingredients").select("recipe_id,name,quantity,unit").not("name", "is", null)).data || [];
    // menu_items.units_sold is our proxy for portions sold (from POS)
    const mis = (await supabase.from("menu_items").select("recipe_id,name,units_sold").eq("restaurant_id", rid).eq("is_active", true)).data || [];
    const recipeIds = [...new Set(mis.map((m: any) => m.recipe_id).filter(Boolean))];
    const recipes = recipeIds.length ? (await supabase.from("recipes").select("id,name").in("id", recipeIds)).data || [] : [];
    const recName = new Map(recipes.map((r: any) => [r.id, r.name]));
    const soldByRecipe = new Map<string, number>();
    mis.forEach((m: any) => { if (m.recipe_id) soldByRecipe.set(m.recipe_id, (soldByRecipe.get(m.recipe_id) || 0) + Number(m.units_sold || 0)); });
    // for each ingredient with variance, find recipes that use it; weight by sold portions × per-portion qty
    const recipeVar = new Map<string, { eur: number; topIng: string; topShare: number }>();
    for (const ing of ingRows) {
      if (Math.abs(ing.varEur) < 0.01) continue;
      const usages = recIngs.filter((ri: any) => (ri.name || "").toLowerCase() === (ing.name || "").toLowerCase());
      if (!usages.length) continue;
      const weights = usages.map((u: any) => {
        const sold = soldByRecipe.get(u.recipe_id) || 0;
        const w = sold * Number(u.quantity || 0);
        return { recipe_id: u.recipe_id, w };
      });
      const total = weights.reduce((a, x) => a + x.w, 0);
      if (total === 0) continue;
      for (const w of weights) {
        const share = w.w / total;
        const allocEur = ing.varEur * share;
        const cur = recipeVar.get(w.recipe_id) || { eur: 0, topIng: "", topShare: 0 };
        const next = { eur: cur.eur + allocEur, topIng: cur.topIng, topShare: cur.topShare };
        if (Math.abs(allocEur) > next.topShare) { next.topIng = ing.name; next.topShare = Math.abs(allocEur); }
        recipeVar.set(w.recipe_id, next);
      }
    }
    for (const [recipe_id, v] of recipeVar.entries()) {
      recipeRows.push({ id: recipe_id, name: recName.get(recipe_id) || "Unknown", varEur: v.eur, topIng: v.topIng });
    }
    recipeRows.sort((a, b) => Math.abs(b.varEur) - Math.abs(a.varEur));
  }
  ingRows.sort((a, b) => Math.abs(b.varEur) - Math.abs(a.varEur));

  const totalLoss = ingRows.filter((r) => r.varEur > 0).reduce((a, r) => a + r.varEur, 0);
  const biggest = ingRows[0];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← the numbers</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Variance · theoretical vs. actual</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">Where the stock went</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">Book = opening stock minus what the recipes say the day's sales should have used. Counted = the physical stock-take. The gap is waste, over-portioning or shrinkage — priced out.</p>

      <div className="mt-6 border-y border-line py-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Unaccounted this period</p>
        <p className="mt-1 font-serif text-4xl text-ink">{eur(totalLoss)}</p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">Across {ingRows.length} tracked ingredients. Biggest leak: {biggest ? noEmoji(biggest.name) : "—"}.</p>
      </div>

      <div className="mt-5 inline-flex rounded-xl border border-line p-1">
        <Link href="/administrate/finance/variance?by=ingredient" className={"rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide " + (by === "ingredient" ? "bg-[color:var(--accent)] text-[#FCEFE7]" : "text-ink-soft")}>By ingredient</Link>
        <Link href="/administrate/finance/variance?by=recipe" className={"rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide " + (by === "recipe" ? "bg-[color:var(--accent)] text-[#FCEFE7]" : "text-ink-soft")}>By recipe</Link>
      </div>

      {by === "ingredient" ? (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {ingRows.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-3">
              <div>
                <p className="font-serif text-[17px] text-ink">{noEmoji(r.name)}</p>
                <p className="font-mono text-[11px] text-clay">book {Math.round(r.book)} · counted {Math.round(r.counted)} {r.unit}</p>
              </div>
              <span className={"font-mono text-[13px] " + (r.varEur > 0.5 ? "text-tomato" : r.varEur < -0.5 ? "text-basil" : "text-clay")}>{Math.abs(r.varEur) < 0.005 ? "ok" : eur(r.varEur)}</span>
            </li>
          ))}
          {!ingRows.length ? <p className="py-3 font-sans text-[14px] text-clay">No counted stock yet.</p> : null}
        </ul>
      ) : (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {recipeRows.map((r, i) => (
            <li key={i} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <Link href={"/develop/menu/" + r.id} className="font-serif text-[17px] text-ink hover:text-ink-soft">{noEmoji(r.name)}</Link>
                <span className={"font-mono text-[13px] " + (r.varEur > 0.5 ? "text-tomato" : r.varEur < -0.5 ? "text-basil" : "text-clay")}>{Math.abs(r.varEur) < 0.005 ? "ok" : eur(r.varEur)}</span>
              </div>
              {r.topIng ? <p className="mt-0.5 font-mono text-[11px] text-clay">mostly: {r.topIng}</p> : null}
            </li>
          ))}
          {!recipeRows.length ? <p className="py-3 font-sans text-[14px] text-clay">No recipe-level allocation yet — needs recipes with ingredients matched to inventory + sales counts.</p> : null}
        </ul>
      )}

      <div className="mt-8 border-y border-dashed border-line py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">Academy · what to aim for</p>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">A healthy kitchen runs variance near zero. A point or two is normal shrink — but a steady gap on one pricey line is usually over-portioning, waste, or stock walking out the door. Chase the biggest euro first, fix the cause, recount next week, and watch it close.</p>
      </div>
    </main>
  );
}
