import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT } from "@/lib/entities";
import AssistantContext from "@/components/AssistantContext";
import CalculationBreakdown from "@/components/recipes/CalculationBreakdown";

export const dynamic = "force-dynamic";

// Precision face — the calculation view. Uses CalculationBreakdown. No serif
// prose here, just tabular-nums, hairlines, and a sticky summary card.
// Folded into the recipe page as the Costing tab (slim OS slice 2): the route
// /develop/menu/[id]/calculation is retired; renders under
// /h/<slug>/menu/recipes/<id>?tab=cost.
export default async function CalculationPage({ params, houseSlug }: { params: { id: string }; houseSlug: string }) {
  const base = `/h/${houseSlug}/menu/recipes`;
  const supabase = supabaseServer();
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];

  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
        <Link href={base} className="font-sans text-sm text-ink-soft">← recipes</Link>
        <p className="mt-8 font-serif text-2xl text-ink">Recipe not found.</p>
      </main>
    );
  }
  const ings: any[] = (await supabase
    .from("recipe_ingredients")
    .select("name,ingredient_name,quantity,unit,line_cost,sort_order,sub_recipe_id,unit_price_eur,cost_source,cost_note,price_id")
    .eq("recipe_id", r.id)
    .order("sort_order")).data || [];
  const dish: any = (await supabase.from("menu_items").select("id,price").eq("recipe_id", r.id).maybeSingle()).data;

  const portions = Number(r.portions) > 0 ? Number(r.portions) : null;
  // cost_per_serving_eur is what the costing run writes; the legacy
  // cost_per_portion column is a hand-typed number from the first import.
  const totalCost = r.cost_per_serving_eur != null
    ? Number(r.cost_per_serving_eur)
    : r.cost_per_portion != null
      ? Number(r.cost_per_portion)
      : ings.reduce((a: number, i: any) => a + Number(i.line_cost || 0), 0);
  const menuPrice = dish?.price != null ? Number(dish.price) : (r.menu_price != null ? Number(r.menu_price) : null);
  const targetFcPct = r.target_food_cost_pct != null ? Number(r.target_food_cost_pct) : 28;

  // Menu-first loop (2026-10-01): the costing run writes unit price + source
  // on every line — invoice, estimate (provisional), sub-recipe — and a note
  // when it could not price one. The basis string is what the cook reads.
  const priceIds = ings.map((i: any) => i.price_id).filter(Boolean);
  const priceUnit = new Map<string, string>();
  if (priceIds.length) {
    const { data: ps } = await supabase.from("ingredient_prices").select("id,unit").in("id", priceIds);
    for (const p of (ps || []) as any[]) priceUnit.set(p.id, p.unit);
  }
  const lines = ings.map((i: any) => ({
    name: i.ingredient_name || i.name,
    quantity: i.quantity,
    unit: i.unit,
    unit_cost: i.unit_price_eur == null ? null : Number(i.unit_price_eur),
    unit_cost_basis: i.unit_price_eur != null
      ? `€${Number(i.unit_price_eur).toFixed(2)} / ${priceUnit.get(i.price_id) || "unit"} · ${i.cost_source === "provisional" ? "estimate" : i.cost_source === "purchase" ? "invoice" : i.cost_source === "confirmed" ? "confirmed" : i.cost_source || ""}`
      : i.cost_source === "sub_recipe" ? "sub-recipe" : i.cost_note || null,
    line_cost: Number(i.line_cost || 0),
  }));

  const allergens: string[] = (r.allergens as string[]) || [];
  const dietary: string[] = (r.dietary as string[]) || [];

  return (
    <main className="mx-auto max-w-[1400px] bg-paper px-0 py-6" style={{ ["--fs-accent" as any]: accent }}>
      <AssistantContext context={{ kind: "calculation", id: r.id, name: r.name, entity, totalCost, menuPrice }} />
      <CalculationBreakdown
        title={noEmoji(r.name)}
        subtitle={[portions ? `per portion, at ${portions} pax` : null, r.cost_source === "purchase" ? "priced from invoices" : r.cost_source === "mixed" ? "part invoice, part estimate" : r.cost_source === "provisional" ? "estimated prices" : null, r.quantities_estimated ? "quantities estimated — confirm" : null, r.cost_coverage != null && Number(r.cost_coverage) < 1 ? `${Math.round(Number(r.cost_coverage) * 100)} % of lines priced` : null].filter(Boolean).join(" · ") || null}
        lines={lines}
        totalCost={totalCost}
        menuPrice={menuPrice}
        targetFcPct={targetFcPct}
        allergens={allergens}
        dietary={dietary}
        accent={accent}
      />
    </main>
  );
}
