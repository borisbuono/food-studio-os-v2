import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/menu-margin/rebuild
//
// Refreshes menu_dish_costing rows from the fresh `recipes.cost_per_portion_eur`
// column (computed from purchase_lines by /api/recipes/compute-all). This
// is the "publish" step — a real cost lands on the /studio/money/menu-margin
// page only after this runs.
//
// For every row already in menu_dish_costing with a matched_recipe_id we
// re-read the recipe's cost + confidence, recompute margin, and update in
// place. Rows without a matched recipe are left alone — the menu-parser
// (scripts/compute_menu_margin.py) owns them.

export async function POST() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: rows, error } = await sb
    .from("menu_dish_costing")
    .select("id, venue, sell_price_eur, matched_recipe_id")
    .not("matched_recipe_id", "is", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const ids = [...new Set((rows as any[] | null || []).map((r) => r.matched_recipe_id))];
  if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const { data: recipes, error: rErr } = await sb
    .from("recipes")
    .select("id, cost_per_portion_eur, cost_confidence")
    .in("id", ids);
  if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 });

  const byId = new Map<string, { cost: number | null; conf: string | null }>();
  for (const r of (recipes as any[]) || []) {
    byId.set(r.id, { cost: r.cost_per_portion_eur ?? null, conf: r.cost_confidence ?? null });
  }

  let updated = 0;
  for (const row of (rows as any[]) || []) {
    const r = byId.get(row.matched_recipe_id);
    if (!r) continue;
    const cost = r.cost;
    // Map internal 'missing' confidence onto the menu_dish_costing check-constraint
    // set ('high','medium','low') — missing publishes as 'low' with a null cost.
    const rawConf = r.conf || "low";
    const conf = rawConf === "missing" ? "low" : rawConf;
    const sell = row.sell_price_eur == null ? null : Number(row.sell_price_eur);
    const marginEur = cost != null && sell != null ? sell - cost : null;
    const marginPct = marginEur != null && sell && sell > 0 ? (marginEur / sell) * 100 : null;

    const { error: uErr } = await sb.from("menu_dish_costing").update({
      cost_per_portion_eur: rawConf === "missing" ? null : cost,
      gross_margin_eur: marginEur,
      gross_margin_pct: marginPct,
      cost_confidence: conf,
      computed_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (!uErr) updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
