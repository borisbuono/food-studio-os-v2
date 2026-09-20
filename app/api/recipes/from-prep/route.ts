import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recipes/from-prep
//   body { entity_id, prep_item_ids: [uuid, ...], name?: string, station? }
//   → creates a new recipe seeded from the prep items' names + qtys;
//     back-links the source prep items to the new recipe.
//     Returns the new recipe + count of items seeded.
//
// The intent (Boris walk 2026-09-20): once the kitchen has prepped a
// component enough times to memorise it, "Save as recipe" from the prep
// list turns that muscle memory into a first-class recipe. Sibling
// items in the same station on the same day roll into a single recipe
// if the caller passes multiple ids.

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const ids: string[] = Array.isArray(body?.prep_item_ids) ? body.prep_item_ids.filter(isUuid) : [];
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!ids.length)        return Response.json({ ok: false, error: "prep_item_ids required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: prepRows, error: pErr } = await sb
    .from("prep_lists")
    .select("id, entity_id, name, station, quantity, unit, per_cover, target_covers, notes")
    .in("id", ids)
    .eq("entity_id", entity_id);
  if (pErr) return Response.json({ ok: false, error: pErr.message }, { status: 500 });

  if (!prepRows || !prepRows.length) {
    return Response.json({ ok: false, error: "no prep items found for entity" }, { status: 404 });
  }

  // Recipe name: caller override → common prefix of names → first item name
  const names = prepRows.map((r: any) => String(r.name || "").trim()).filter(Boolean);
  const recipeName = String(body?.name || "").trim() || commonPrefix(names) || names[0] || "Untitled recipe";
  const station: string | null = body?.station ?? (prepRows.find((r: any) => r.station)?.station ?? null);

  // per_cover on the first prep row becomes the recipe's cover_multiplier
  // hint — same intent (portions of this per one cover forecasted).
  const first = prepRows[0] as any;
  const coverMultiplier: number | null = typeof first.per_cover === "number" ? first.per_cover : null;

  const { data: recipe, error: rErr } = await sb.from("recipes").insert({
    entity_id,
    name:             recipeName,
    station,
    category:         "component",
    yield_qty:        first.quantity ?? null,
    yield_unit:       first.unit ?? "portions",
    cover_multiplier: coverMultiplier,
    method:           null,
    notes:            "Seeded from prep list on " + new Date().toISOString().slice(0, 10),
    is_active:        true,
    created_by:       u.user.id,
  }).select("*").single();

  if (rErr) return Response.json({ ok: false, error: rErr.message }, { status: 500 });

  // Seed one ingredient per prep row so the recipe has structure to edit.
  const ingredientRows = prepRows.map((r: any, idx: number) => ({
    recipe_id:       recipe.id,
    ingredient_name: String(r.name).trim(),
    name:            String(r.name).trim(),
    quantity:        r.quantity ?? null,
    unit:            r.unit ?? "unit",
    notes:           r.notes ?? null,
    sort_order:      idx,
    is_optional:     false,
  }));
  if (ingredientRows.length) {
    const { error: iErr } = await sb.from("recipe_ingredients").insert(ingredientRows);
    if (iErr) return Response.json({ ok: false, error: iErr.message, recipe }, { status: 500 });
  }

  // Back-link the seed prep items to the new recipe.
  await sb.from("prep_lists").update({ linked_recipe_id: recipe.id }).in("id", ids);

  return Response.json({ ok: true, recipe, seeded_ingredients: ingredientRows.length });
}

function commonPrefix(strs: string[]): string {
  if (!strs.length) return "";
  let p = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (p && !strs[i].toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
    if (!p) return "";
  }
  return p.trim().replace(/[\s\-—:]+$/, "");
}
