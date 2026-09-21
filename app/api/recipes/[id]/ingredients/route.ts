import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeRecipeCost, persistRecipeCost, normalizeName } from "@/lib/recipes/computeCost";
import { refreshMenuMargin } from "@/lib/recipes/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// POST /api/recipes/[id]/ingredients
// Body: { ingredient_name, quantity, unit?, priced_as? }
//
// Appends ONE ingredient to a recipe — the inline "add missing ingredient"
// on /studio/money/menu-margin. `priced_as` (a canonical ingredient name)
// links the typed name to that canonical via ingredient_aliases so it
// prices immediately. Then recomputes this recipe and republishes its
// menu-margin rows, and returns the fresh numbers so the row updates
// without a full rebuild.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.ingredient_name ?? "").trim();
  const qty = num(body?.quantity);
  const unit = body?.unit ? String(body.unit).trim() || null : null;
  const pricedAs = body?.priced_as ? String(body.priced_as).trim() || null : null;
  if (!name) return NextResponse.json({ ok: false, error: "ingredient name required" }, { status: 400 });
  if (qty == null || qty <= 0) return NextResponse.json({ ok: false, error: "quantity must be a positive number" }, { status: 400 });

  const { data: recipe, error: rErr } = await sb.from("recipes").select("id, entity_id, origin_recipe_id").eq("id", params.id).maybeSingle();
  if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 });
  if (!recipe) return NextResponse.json({ ok: false, error: "recipe not found" }, { status: 404 });

  // Shared recipe (mirror): ingredients live on the origin row; the DB sync
  // trigger copies them to every venue, so costing below still runs on
  // this venue's row with this venue's prices.
  const contentId: string = (recipe as any).origin_recipe_id || params.id;

  const { data: last } = await sb
    .from("recipe_ingredients")
    .select("sort_order")
    .eq("recipe_id", contentId)
    .order("sort_order", { ascending: false, nullsFirst: false })
    .limit(1);
  const nextSort = (Number((last as any[])?.[0]?.sort_order) || 0) + 1;

  const { error: iErr } = await sb.from("recipe_ingredients").insert({
    recipe_id: contentId,
    ingredient_name: name,
    name,
    quantity: qty,
    unit,
    sort_order: nextSort,
  });
  if (iErr) return NextResponse.json({ ok: false, error: "insert failed: " + iErr.message }, { status: 500 });

  let aliasLinked = false;
  const entityId = (recipe as any).entity_id as string | null;
  if (pricedAs && entityId && normalizeName(pricedAs) !== normalizeName(name)) {
    const { error: aErr } = await sb
      .from("ingredient_aliases")
      .upsert(
        { entity_id: entityId, alias: name, canonical_name: pricedAs, unit_conversion: 1 },
        { onConflict: "entity_id,alias", ignoreDuplicates: true }
      );
    aliasLinked = !aErr;
  }

  try {
    const res = await computeRecipeCost(sb, params.id);
    await persistRecipeCost(sb, res);
    const menu = await refreshMenuMargin(sb, { recipeIds: [params.id], results: new Map([[params.id, res]]) });
    const line = [...res.breakdown].reverse().find((b) => normalizeName(b.ingredient_name) === normalizeName(name));
    return NextResponse.json({
      ok: true,
      alias_linked: aliasLinked,
      line: line ? { status: line.status, canonical_name: line.canonical_name, line_cost_eur: line.line_cost_eur, note: line.note ?? null } : null,
      recipe: {
        cost_per_portion_eur: res.cost_per_portion_eur,
        confidence: res.confidence,
        ingredient_count: res.ingredient_count,
        priced_count: res.priced_count,
      },
      menu_rows_updated: menu.updated,
    });
  } catch (e: any) {
    // The ingredient is saved; only the recompute failed.
    return NextResponse.json({ ok: true, alias_linked: aliasLinked, recompute_error: String(e?.message || e) });
  }
}
