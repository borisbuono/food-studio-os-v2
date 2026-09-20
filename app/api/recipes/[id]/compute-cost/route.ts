import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeRecipeCost, persistRecipeCost } from "@/lib/recipes/computeCost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recipes/[id]/compute-cost
// Recomputes cost_per_portion_eur from purchase_lines and persists onto
// recipes.cost_per_portion_eur + cost_confidence.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  try {
    const res = await computeRecipeCost(sb, params.id);
    await persistRecipeCost(sb, res);
    return NextResponse.json({
      ok: true,
      recipe_id: res.recipe_id,
      cost_per_portion_eur: res.cost_per_portion_eur,
      confidence: res.confidence,
      ingredient_count: res.ingredient_count,
      priced_count: res.priced_count,
      missing_ingredients: res.missing_ingredients,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
