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
export default async function CalculationPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];

  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
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
    </main>
  );
}
