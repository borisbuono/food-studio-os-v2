import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/prep/list/from-menu
//   body { entity_id, service_date, target_covers?, sections? }
//   → "Generate prep for tonight": one prep row per dish on the CURRENT menu
//     that is bound to a recipe, plus one row per component the recipe is
//     built from (sub-recipes: pizza dough, focaccia dough, pancake batter …),
//     grouped by the recipe's station (else the menu section). Every row
//     carries linked_recipe_id + linked_menu_item_id so what the kitchen
//     actually prepped feeds back to the dish (menu-first loop, slice 3).
//   Idempotent on station+name for the day. Returns the inserted ids so the
//   client can undo the whole batch in one tap (/api/prep/list/undo).
//   Nothing is auto-generated: this runs only when someone taps the button.

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function isIsoDate(x: any): x is string {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

// Menu sections the kitchen does not prep (the bar makes them to order / bought as sold).
const NOT_KITCHEN = new Set(["wine", "spirit", "coffee_tea", "side", "cocktail", "soft"]);

const STATION_FOR_SECTION: Record<string, string> = {
  breakfast: "Bar & Bakery", dessert: "Pastry", snack: "Cold Station", salad: "Cold Station",
  dinner: "Hot Station", lunch: "Hot Station", tasting_menu: "Pass", pizza: "Pizzeria",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = body?.entity_id;
  const service_date = body?.service_date;
  const target_covers: number | null = typeof body?.target_covers === "number" && Number.isFinite(body.target_covers) && body.target_covers > 0 ? body.target_covers : null;
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id uuid required" }, { status: 400 });
  if (!isIsoDate(service_date)) return Response.json({ ok: false, error: "service_date YYYY-MM-DD required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: rest } = await sb.from("restaurants").select("id").eq("entity_id", entity_id).limit(1).maybeSingle();
  if (!rest) return Response.json({ ok: false, error: "no restaurant for this house" }, { status: 404 });

  const { data: items, error: iErr } = await sb
    .from("menu_items")
    .select("id, name, section, recipe_id, recipe_match_method")
    .eq("restaurant_id", rest.id).eq("is_active", true).not("recipe_id", "is", null)
    .order("section").order("name");
  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });
  const dishes = (items || []).filter((i: any) => !NOT_KITCHEN.has(String(i.section || "")) && i.recipe_match_method !== "none");
  if (!dishes.length) return Response.json({ ok: true, inserted: 0, skipped: 0, ids: [], note: "no dish on the current menu is bound to a recipe yet" });

  const rids = [...new Set(dishes.map((d: any) => d.recipe_id as string))];
  const { data: recipes } = await sb.from("recipes").select("id, name, station, portion_unit").in("id", rids);
  const recipeById = new Map((recipes || []).map((r: any) => [r.id, r]));

  // components = sub-recipes the bound recipes point at (one level)
  const { data: subLines } = await sb.from("recipe_ingredients").select("recipe_id, sub_recipe_id, linked_recipe_id, quantity, unit").in("recipe_id", rids);
  const subIds = [...new Set((subLines || []).map((l: any) => l.sub_recipe_id || l.linked_recipe_id).filter(Boolean))] as string[];
  const subs = new Map<string, any>();
  if (subIds.length) {
    const { data: subRecipes } = await sb.from("recipes").select("id, name, station, yield_qty, yield_unit, servings").in("id", subIds);
    for (const s of (subRecipes || []) as any[]) subs.set(s.id, s);
  }
  // which dishes need which component, to say so in the notes
  const usedBy = new Map<string, string[]>();
  for (const l of (subLines || []) as any[]) {
    const sid = l.sub_recipe_id || l.linked_recipe_id; if (!sid) continue;
    const dish = dishes.find((d: any) => d.recipe_id === l.recipe_id);
    if (!dish) continue;
    const list = usedBy.get(sid) || []; if (!list.includes(dish.name)) list.push(dish.name); usedBy.set(sid, list);
  }

  const { data: existing, error: eErr } = await sb.from("prep_lists").select("station, name").eq("entity_id", entity_id).eq("service_date", service_date);
  if (eErr) return Response.json({ ok: false, error: eErr.message }, { status: 500 });
  const seen = new Set((existing || []).map((r: any) => `${(r.station ?? "").toLowerCase()}::${(r.name ?? "").toLowerCase()}`));

  const rows: any[] = [];
  let skipped = 0;
  const push = (row: any) => {
    const key = `${(row.station ?? "").toLowerCase()}::${(row.name ?? "").toLowerCase()}`;
    if (seen.has(key)) { skipped++; return; }
    seen.add(key); rows.push(row);
  };

  // components first — they are what gets made before service
  for (const [sid, s] of subs) {
    push({
      entity_id, service_date, station: s.station || "Prep", name: s.name,
      quantity: s.yield_qty ?? null, unit: s.yield_unit ?? (s.servings ? "portions" : null),
      per_cover: null, target_covers, status: "todo",
      notes: `component for ${(usedBy.get(sid) || []).join(", ")}`,
      linked_recipe_id: sid, linked_menu_item_id: null,
    });
  }
  for (const d of dishes as any[]) {
    const r = recipeById.get(d.recipe_id);
    push({
      entity_id, service_date,
      station: r?.station || STATION_FOR_SECTION[String(d.section || "")] || d.section || "Kitchen",
      name: d.name, quantity: target_covers, unit: target_covers ? "portions" : null,
      per_cover: null, target_covers, status: "todo",
      notes: "from tonight's menu",
      linked_recipe_id: d.recipe_id, linked_menu_item_id: d.id,
    });
  }
  if (!rows.length) return Response.json({ ok: true, inserted: 0, skipped, ids: [] });

  const { data: inserted, error: insErr } = await sb.from("prep_lists").insert(rows).select("id");
  if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });
  return Response.json({ ok: true, inserted: (inserted || []).length, skipped, ids: (inserted || []).map((r: any) => r.id), dishes: dishes.length, components: subs.size });
}
