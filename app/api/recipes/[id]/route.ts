import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/recipes/[id]              → recipe + ingredients
// PATCH  /api/recipes/[id]              → update recipe fields and/or replace
//                                         ingredients (if body.ingredients
//                                         supplied — treated as full replace)
// DELETE /api/recipes/[id]              → soft-delete (is_active=false)

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: recipe, error } = await sb.from("recipes").select("*").eq("id", params.id).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!recipe) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const { data: ingredients, error: iErr } = await sb
    .from("recipe_ingredients")
    .select("id, ingredient_name, name, quantity, unit, linked_recipe_id, linked_ingredient_id, sub_recipe_id, notes, sort_order, order_idx, is_optional, line_cost")
    .eq("recipe_id", params.id)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("order_idx",  { ascending: true, nullsFirst: false });
  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    recipe,
    ingredients: (ingredients || []).map((i: any) => ({
      ...i,
      // Normalise legacy fields into the canonical names used by the UI.
      ingredient_name:  i.ingredient_name ?? i.name,
      linked_recipe_id: i.linked_recipe_id ?? i.sub_recipe_id,
      sort_order:       i.sort_order ?? i.order_idx ?? 0,
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const patch: any = {};
  for (const k of [
    "name", "station", "category", "yield_qty", "yield_unit",
    "portion_size", "portion_unit", "method", "notes",
    "cover_multiplier", "sell_price_eur", "linked_menu_item_id", "is_active",
  ]) {
    if (k in body) patch[k] = body[k];
  }
  // Numeric coercion
  for (const k of ["yield_qty", "portion_size", "cover_multiplier", "sell_price_eur"]) {
    if (k in patch) patch[k] = num(patch[k]);
  }

  // Shared recipes (2026-09-21): a mirror's CONTENT lives on its origin
  // (canonical) row; the DB refuses content edits on a mirror. Content
  // fields + ingredients go to the origin and propagate to every venue;
  // venue fields (station, price, menu link, active) stay on this row.
  const { data: self } = await sb.from("recipes").select("id, origin_recipe_id").eq("id", params.id).maybeSingle();
  const contentId: string = (self as any)?.origin_recipe_id || params.id;
  const CONTENT = new Set(["name", "category", "yield_qty", "yield_unit", "portion_size", "portion_unit", "method", "notes"]);
  const contentPatch: any = {};
  const venuePatch: any = {};
  for (const [k, v] of Object.entries(patch)) {
    if (contentId !== params.id && CONTENT.has(k) && k !== "notes") contentPatch[k] = v;
    else venuePatch[k] = v;
  }

  if (Object.keys(contentPatch).length) {
    const { error } = await sb.from("recipes").update(contentPatch).eq("id", contentId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (Object.keys(venuePatch).length) {
    const { error } = await sb.from("recipes").update(venuePatch).eq("id", params.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (Array.isArray(body?.ingredients)) {
    // Full-replace semantics — simplest, avoids per-row diff bugs.
    // On a mirror this replaces the ORIGIN's list; the DB sync trigger
    // rebuilds every venue's copy.
    const { error: dErr } = await sb.from("recipe_ingredients").delete().eq("recipe_id", contentId);
    if (dErr) return Response.json({ ok: false, error: dErr.message }, { status: 500 });

    const rows = body.ingredients
      .filter((i: any) => i && typeof i.ingredient_name === "string" && i.ingredient_name.trim().length)
      .map((i: any, idx: number) => ({
        recipe_id:         contentId,
        ingredient_name:   String(i.ingredient_name).trim(),
        name:              String(i.ingredient_name).trim(),
        quantity:          num(i.quantity),
        unit:              i.unit ?? null,
        linked_recipe_id:  isUuid(i.linked_recipe_id) ? i.linked_recipe_id : null,
        notes:             i.notes ?? null,
        sort_order:        Number.isFinite(Number(i.sort_order)) ? Number(i.sort_order) : idx,
        is_optional:       !!i.is_optional,
      }));
    if (rows.length) {
      const { error: iErr } = await sb.from("recipe_ingredients").insert(rows);
      if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });
    }
  }

  const { data: recipe } = await sb.from("recipes").select("*").eq("id", params.id).maybeSingle();
  return Response.json({ ok: true, recipe });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { error } = await sb.from("recipes").update({ is_active: false }).eq("id", params.id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

function num(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
