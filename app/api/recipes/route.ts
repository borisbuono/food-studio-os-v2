import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/recipes?entity=<uuid>&station=<opt>&search=<opt>
//   → active recipes for the entity, optional station filter, optional
//     name search (ilike). Includes ingredient counts so the list card
//     can show "n components" without a second round-trip.
// POST /api/recipes
//   body { entity_id, name, station?, category?, yield_qty?, yield_unit?,
//          portion_size?, portion_unit?, method?, notes?, cover_multiplier?,
//          sell_price_eur?, linked_menu_item_id?, ingredients?: [ ... ] }
//   → { ok, recipe }
//
// ingredients rows accept { ingredient_name, quantity, unit,
//                           linked_recipe_id?, notes?, sort_order?,
//                           is_optional? }

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const station = url.searchParams.get("station");
  const search = url.searchParams.get("search");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  let q = sb
    .from("recipes")
    .select("id, entity_id, name, station, category, yield_qty, yield_unit, portion_size, portion_unit, cover_multiplier, sell_price_eur, cost_per_serving_eur, cost_per_portion, is_active, linked_menu_item_id, created_at, updated_at")
    .eq("entity_id", entity)
    .eq("is_active", true)
    .order("station", { ascending: true, nullsFirst: false })
    .order("name",    { ascending: true });

  if (station) q = q.eq("station", station);
  if (search)  q = q.ilike("name", `%${search}%`);

  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const recipes = data || [];
  const ids = recipes.map((r: any) => r.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: ings } = await sb
      .from("recipe_ingredients")
      .select("recipe_id")
      .in("recipe_id", ids);
    for (const row of ings || []) counts[(row as any).recipe_id] = (counts[(row as any).recipe_id] || 0) + 1;
  }

  return Response.json({
    ok: true,
    recipes: recipes.map((r: any) => ({ ...r, ingredient_count: counts[r.id] || 0 })),
    count: recipes.length,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const name = String(body?.name || "").trim();
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!name)              return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const row: any = {
    entity_id,
    name,
    station:             body?.station ?? null,
    category:            body?.category ?? null,
    yield_qty:           num(body?.yield_qty),
    yield_unit:          body?.yield_unit ?? null,
    portion_size:        num(body?.portion_size),
    portion_unit:        body?.portion_unit ?? null,
    method:              body?.method ?? null,
    notes:               body?.notes ?? null,
    cover_multiplier:    num(body?.cover_multiplier),
    sell_price_eur:      num(body?.sell_price_eur),
    linked_menu_item_id: isUuid(body?.linked_menu_item_id) ? body.linked_menu_item_id : null,
    is_active:           true,
    created_by:          u.user.id,
  };

  const { data: recipe, error } = await sb.from("recipes").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const ings: any[] = Array.isArray(body?.ingredients) ? body.ingredients : [];
  if (ings.length && recipe?.id) {
    const rows = ings
      .filter((i) => i && typeof i.ingredient_name === "string" && i.ingredient_name.trim().length)
      .map((i, idx) => ({
        recipe_id:         recipe.id,
        ingredient_name:   String(i.ingredient_name).trim(),
        name:              String(i.ingredient_name).trim(), // legacy alias
        quantity:          num(i.quantity),
        unit:              i.unit ?? null,
        linked_recipe_id:  isUuid(i.linked_recipe_id) ? i.linked_recipe_id : null,
        notes:             i.notes ?? null,
        sort_order:        Number.isFinite(Number(i.sort_order)) ? Number(i.sort_order) : idx,
        is_optional:       !!i.is_optional,
      }));
    if (rows.length) {
      const { error: iErr } = await sb.from("recipe_ingredients").insert(rows);
      if (iErr) return Response.json({ ok: false, error: iErr.message, recipe }, { status: 500 });
    }
  }

  return Response.json({ ok: true, recipe });
}

function num(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
