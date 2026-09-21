import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeRecipeCost, persistRecipeCost } from "@/lib/recipes/computeCost";
import { refreshMenuMargin } from "@/lib/recipes/recompute";
import { E_BM, E_TALLER } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENUE_ENTITY: Record<string, string> = { bm: E_BM, taller: E_TALLER };

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

// The card prints "Dish name · what's in it". The recipe wants the name only.
function dishToRecipeName(dishName: string): string {
  return dishName.split("·")[0].replace(/\s+/g, " ").trim() || dishName.trim();
}

// PATCH /api/menu-margin/[id]
//   { matched_recipe_id: uuid }  → point this dish at that recipe
//   { matched_recipe_id: null }  → unlink (the matcher's guess was wrong and
//                                  no recipe fits yet)
//   { create_recipe: true }      → create an empty recipe named after the
//                                  dish, in the venue's entity, and link it
//
// The fuzzy matcher put Parmigiana on the Milanesa and Pizza Margarita on five
// different pizzas. Fixing that needed a developer; now it doesn't. Every
// change recomputes the recipe and republishes the row, so the number on
// screen is never left describing the old link.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { data: row, error: rowErr } = await sb
    .from("menu_dish_costing")
    .select("id, venue, section, dish_name, sell_price_eur, matched_recipe_id")
    .eq("id", params.id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ ok: false, error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ ok: false, error: "dish row not found" }, { status: 404 });

  const entityId = VENUE_ENTITY[(row as any).venue];
  let recipeId: string | null = null;
  let recipeName: string | null = null;
  let created = false;

  if (body?.create_recipe) {
    if (!entityId) return NextResponse.json({ ok: false, error: "venue has no entity" }, { status: 400 });
    const name = dishToRecipeName(String((row as any).dish_name || ""));
    const { data: made, error: cErr } = await sb
      .from("recipes")
      .insert({
        name,
        entity_id: entityId,
        section: (row as any).section ?? null,
        is_active: true,
        yield_qty: 1,
        yield_unit: "portion",
        sell_price_eur: (row as any).sell_price_eur ?? null,
        notes: "created from the menu-margin page",
      })
      .select("id, name")
      .maybeSingle();
    if (cErr || !made) return NextResponse.json({ ok: false, error: "create failed: " + (cErr?.message || "no row") }, { status: 500 });
    recipeId = (made as any).id;
    recipeName = (made as any).name;
    created = true;
  } else if (body?.matched_recipe_id === null) {
    recipeId = null;
  } else if (isUuid(body?.matched_recipe_id)) {
    const { data: rec, error: recErr } = await sb
      .from("recipes")
      .select("id, name, entity_id")
      .eq("id", body.matched_recipe_id)
      .maybeSingle();
    if (recErr) return NextResponse.json({ ok: false, error: recErr.message }, { status: 500 });
    if (!rec) return NextResponse.json({ ok: false, error: "recipe not found" }, { status: 404 });
    // Don't let a BM dish point at a Taller recipe — the pricer reads
    // purchase lines per entity and would silently price it from the wrong
    // venue's invoices.
    if (entityId && (rec as any).entity_id && (rec as any).entity_id !== entityId) {
      return NextResponse.json({ ok: false, error: "that recipe belongs to the other venue" }, { status: 400 });
    }
    recipeId = (rec as any).id;
    recipeName = (rec as any).name;
  } else {
    return NextResponse.json({ ok: false, error: "matched_recipe_id (uuid or null) or create_recipe required" }, { status: 400 });
  }

  const { data: upd, error: uErr } = await sb
    .from("menu_dish_costing")
    .update({
      matched_recipe_id: recipeId,
      matched_recipe_name: recipeName,
      match_score: recipeId ? 1 : null,   // 1 = a human said so
      cost_per_portion_eur: null,
      gross_margin_eur: null,
      gross_margin_pct: null,
      cost_confidence: "low",
      price_asof: null,
      price_tier: null,
      missing_components: recipeId ? [] : [{ note: "no recipe linked" }],
      computed_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("id");
  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
  if (!upd || upd.length === 0) return NextResponse.json({ ok: false, error: "update touched no rows (RLS?)" }, { status: 403 });

  if (!recipeId) return NextResponse.json({ ok: true, unlinked: true });

  try {
    const res = await computeRecipeCost(sb, recipeId);
    await persistRecipeCost(sb, res);
    await refreshMenuMargin(sb, { recipeIds: [recipeId], results: new Map([[recipeId, res]]) });
    return NextResponse.json({
      ok: true,
      created,
      recipe: { id: recipeId, name: recipeName, cost_per_portion_eur: res.cost_per_portion_eur, confidence: res.confidence, ingredient_count: res.ingredient_count, priced_count: res.priced_count, price_asof: res.price_asof },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: true, created, recipe: { id: recipeId, name: recipeName }, recompute_error: String(e?.message || e) });
  }
}
