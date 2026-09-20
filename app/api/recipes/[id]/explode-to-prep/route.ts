import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recipes/[id]/explode-to-prep
//   body { entity_id, service_date, target_covers? }
//   → materialises prep_lists rows from the recipe's ingredients, scaled
//     to target_covers via cover_multiplier when present. Recipe name is
//     also inserted as a "parent" prep item back-linked to the recipe so
//     the Chef can see the roll-up on the board. Idempotent: an existing
//     station+name pair for the day is skipped.
//
// Scaling rule (mirrors /api/prep/list/generate):
//   scale = (target_covers ?? 0) * (recipe.cover_multiplier ?? 1)
//   if scale <= 0, we fall back to the ingredient's quantity as-is.

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function isIsoDate(x: any): x is string {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid recipe id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const service_date = String(body?.service_date || "");
  const target_covers: number | null =
    typeof body?.target_covers === "number" && Number.isFinite(body.target_covers) && body.target_covers > 0
      ? body.target_covers
      : null;

  if (!isUuid(entity_id))     return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!isIsoDate(service_date)) return Response.json({ ok: false, error: "service_date YYYY-MM-DD required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: recipe, error: rErr } = await sb
    .from("recipes")
    .select("id, entity_id, name, station, cover_multiplier, yield_qty, yield_unit, portion_size, portion_unit")
    .eq("id", params.id)
    .maybeSingle();
  if (rErr) return Response.json({ ok: false, error: rErr.message }, { status: 500 });
  if (!recipe) return Response.json({ ok: false, error: "recipe not found" }, { status: 404 });

  const { data: ings, error: iErr } = await sb
    .from("recipe_ingredients")
    .select("id, ingredient_name, name, quantity, unit, sort_order, order_idx, is_optional")
    .eq("recipe_id", params.id)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("order_idx",  { ascending: true, nullsFirst: false });
  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });

  const coverMul: number = typeof recipe.cover_multiplier === "number" && recipe.cover_multiplier > 0
    ? recipe.cover_multiplier
    : 1;
  const scale: number | null = target_covers != null ? target_covers * coverMul : null;

  // Existing prep rows for the day so we don't double-book.
  const { data: existing, error: eErr } = await sb
    .from("prep_lists")
    .select("station, name")
    .eq("entity_id", entity_id)
    .eq("service_date", service_date);
  if (eErr) return Response.json({ ok: false, error: eErr.message }, { status: 500 });
  const seen = new Set(
    (existing || []).map((r: any) => `${(r.station ?? "").toLowerCase()}::${(r.name ?? "").toLowerCase()}`)
  );

  const station: string | null = recipe.station ?? null;
  const parentName = String(recipe.name || "").trim();
  const rows: any[] = [];

  // Parent row (the recipe itself) — the roll-up prep task.
  const parentKey = `${(station ?? "").toLowerCase()}::${parentName.toLowerCase()}`;
  if (parentName && !seen.has(parentKey)) {
    seen.add(parentKey);
    let parentQty: number | null = recipe.yield_qty ?? null;
    if (scale != null && parentQty != null) parentQty = round3(parentQty * scale);
    else if (scale != null) parentQty = round3(scale); // portions
    rows.push({
      entity_id,
      service_date,
      station,
      name:            parentName,
      quantity:        parentQty,
      unit:            recipe.yield_unit ?? "portions",
      per_cover:       recipe.cover_multiplier ?? null,
      target_covers,
      status:          "todo",
      linked_recipe_id: recipe.id,
      notes:           null,
    });
  }

  // Ingredient rows scaled to covers.
  for (const ing of ings || []) {
    const rawName = String((ing as any).ingredient_name || (ing as any).name || "").trim();
    if (!rawName) continue;
    if ((ing as any).is_optional) continue;
    const key = `${(station ?? "").toLowerCase()}::${rawName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let qty: number | null = (ing as any).quantity ?? null;
    if (qty != null && scale != null) qty = round3(qty * scale);

    rows.push({
      entity_id,
      service_date,
      station,
      name:            rawName,
      quantity:        qty,
      unit:            (ing as any).unit ?? null,
      per_cover:       null,
      target_covers,
      status:          "todo",
      linked_recipe_id: recipe.id,
      notes:           null,
    });
  }

  if (!rows.length) {
    return Response.json({ ok: true, inserted: 0, skipped: (ings?.length || 0), prep_item_ids: [] });
  }

  const { data: inserted, error: insErr } = await sb.from("prep_lists").insert(rows).select("id");
  if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    inserted: (inserted || []).length,
    skipped: (ings?.length || 0) + 1 - rows.length,
    prep_item_ids: (inserted || []).map((r: any) => r.id),
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
