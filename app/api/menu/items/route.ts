import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/menu/items?entity=<uuid>
//   → the venue's CURRENT menu (active menu_items of its restaurant) with the
//     recipe each one is bound to, how the bind was made, the 3 nearest
//     recipes (for the Bind control) and the cost fields the recost job
//     writes (slice 2). Worst margin first; unbound rows at the top.
//
// Menu-first loop (Boris 2026-10-01): the menu item is the root object.

function isUuid(x: string | null): x is string {
  return !!x && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export type MenuLoopItem = {
  id: string;
  name: string;
  section: string | null;
  category: string | null;
  price: number | null;
  recipe_id: string | null;
  recipe_name: string | null;
  recipe_needs_review: boolean;
  recipe_quantities_estimated: boolean;
  recipe_match_method: string | null;
  recipe_match_score: number | null;
  recipe_candidates: Array<{ recipe_id: string; name: string; score: number; line_count?: number }>;
  computed_cost: number | null;
  food_cost_pct: number | null;
  cost_confidence: string | null;
  costed_at: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: rest } = await sb.from("restaurants").select("id").eq("entity_id", entity).limit(1).maybeSingle();
  if (!rest) return Response.json({ ok: true, items: [], restaurant_id: null });

  const { data: rows, error } = await sb
    .from("menu_items")
    .select("id,name,section,category,price,recipe_id,recipe_match_method,recipe_match_score,recipe_candidates,computed_cost,food_cost_percent_actual,cost_confidence,costed_at")
    .eq("restaurant_id", rest.id)
    .eq("is_active", true)
    .order("section", { ascending: true })
    .order("name", { ascending: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const rids = [...new Set((rows || []).map((r: any) => r.recipe_id).filter(Boolean))] as string[];
  const recipeById = new Map<string, any>();
  if (rids.length) {
    const { data: recs } = await sb.from("recipes").select("id,name,metadata,origin_recipe_id").in("id", rids);
    for (const r of (recs || []) as any[]) recipeById.set(r.id, r);
    // review flags live on the canonical; a mirror only carries mirror_of
    const canon = [...new Set((recs || []).map((r: any) => r.origin_recipe_id).filter(Boolean))] as string[];
    if (canon.length) {
      const { data: cs } = await sb.from("recipes").select("id,metadata").in("id", canon);
      const cm = new Map((cs || []).map((c: any) => [c.id, c.metadata || {}]));
      for (const r of recipeById.values()) if (r.origin_recipe_id && cm.has(r.origin_recipe_id)) r.canon_meta = cm.get(r.origin_recipe_id);
    }
  }

  const num = (v: any) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const items: MenuLoopItem[] = (rows || []).map((r: any) => {
    const rec = r.recipe_id ? recipeById.get(r.recipe_id) : null;
    const meta = { ...(rec?.canon_meta || {}), ...(rec?.metadata || {}) };
    return {
      id: r.id, name: r.name, section: r.section ?? null, category: r.category ?? null, price: num(r.price),
      recipe_id: r.recipe_id ?? null, recipe_name: rec?.name ?? null,
      recipe_needs_review: meta.needs_boris_review === true || meta.status === "shell",
      recipe_quantities_estimated: meta.quantities_estimated === true,
      recipe_match_method: r.recipe_match_method ?? null,
      recipe_match_score: num(r.recipe_match_score),
      recipe_candidates: Array.isArray(r.recipe_candidates) ? r.recipe_candidates : [],
      computed_cost: num(r.computed_cost),
      food_cost_pct: num(r.food_cost_percent_actual),
      cost_confidence: r.cost_confidence ?? null,
      costed_at: r.costed_at ?? null,
    };
  });

  // Worst first: unbound dishes (a question) above costed ones, costed ones by
  // margin ascending, "no recipe applies" rows (a bottle of wine) last.
  const rank = (i: MenuLoopItem) => {
    if (i.recipe_match_method === "none") return 3;
    if (!i.recipe_id) return 0;
    if (i.food_cost_pct == null) return 1;
    return 2;
  };
  items.sort((a, b) => rank(a) - rank(b) || ((b.food_cost_pct ?? -1) - (a.food_cost_pct ?? -1)) || a.name.localeCompare(b.name));

  return Response.json({ ok: true, restaurant_id: rest.id, items });
}
