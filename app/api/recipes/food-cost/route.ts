// GET /api/recipes/food-cost?name=<dish>
// Voice answer endpoint for the Chef FAB — "what's the food cost on [dish]?"
// Returns { menu_price, cost_per_serving, food_cost_percent, target, alert }
// so the FAB can read a spoken answer live.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { foodCostPercent, overTargetAlert } from "@/lib/recipes/calculation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  if (!name && !id) return NextResponse.json({ error: "name or id required" }, { status: 400 });

  const supabase = supabaseServer();
  let query = supabase.from("menu_items").select("id,name,price,cost,recipe_id,target_food_cost_percent");
  if (id) query = query.eq("id", id);
  else query = query.ilike("name", `%${name}%`);
  const { data: items } = await query.limit(5);
  const item = (items || [])[0];
  if (!item) return NextResponse.json({ error: "not_found", searched: name || id }, { status: 404 });

  let cps: number | null = null;
  if (item.recipe_id) {
    const { data: recipe } = await supabase.from("recipes").select("cost_per_serving_eur").eq("id", item.recipe_id).maybeSingle();
    cps = recipe?.cost_per_serving_eur ?? null;
  }
  if (cps == null && item.cost != null) cps = Number(item.cost);
  const target = item.target_food_cost_percent ?? 30;
  const fcp = foodCostPercent(cps, item.price ?? null);
  const alert = overTargetAlert(fcp, target);

  const spoken = fcp == null
    ? `I can't calculate the food cost for ${item.name} yet — either the recipe cost or the menu price is missing.`
    : alert
      ? `${item.name} is running at ${fcp!.toFixed(1)} percent food cost against a ${Number(target).toFixed(0)} percent target. That's over by more than five points — worth reviewing.`
      : `${item.name} is at ${fcp!.toFixed(1)} percent food cost. Target is ${Number(target).toFixed(0)} percent. In range.`;

  return NextResponse.json({
    menu_item_id: item.id,
    name: item.name,
    menu_price: item.price,
    cost_per_serving: cps,
    food_cost_percent: fcp,
    target_food_cost_percent: target,
    alert,
    spoken,
  });
}
