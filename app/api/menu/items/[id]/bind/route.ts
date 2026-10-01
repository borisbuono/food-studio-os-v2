import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/menu/items/[id]/bind
//   body { recipe_id }        → bind this menu item to that recipe (human, score 1).
//                               A Holdings canonical is mirrored into the venue first.
//   body { accept: true }     → keep the current low-confidence match; marks it human-confirmed.
//   body { shell: true }      → no recipe exists: create a SHELL (needs_boris_review) and bind it.
//   body { unbind: true }     → clear the binding.
// Every path is one tap and reversible from the same row (Foundation §6).

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid menu item id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  if (body?.unbind === true) {
    const { data, error } = await sb.from("menu_items")
      .update({ recipe_id: null, recipe_match_method: null, recipe_match_score: null, bound_at: null, cost_confidence: "unbound", computed_cost: null, food_cost_percent_actual: null })
      .eq("id", params.id).select("id");
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    if (!data?.length) return Response.json({ ok: false, error: "not allowed" }, { status: 403 });
    return Response.json({ ok: true, recipe_id: null });
  }

  if (body?.accept === true) {
    const { data: mi } = await sb.from("menu_items").select("recipe_id").eq("id", params.id).maybeSingle();
    if (!mi?.recipe_id) return Response.json({ ok: false, error: "nothing bound to accept" }, { status: 400 });
    const { data, error } = await sb.rpc("menu_item_bind_recipe", { p_item: params.id, p_recipe: mi.recipe_id, p_method: "human", p_score: 1 });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, recipe_id: data });
  }

  if (body?.shell === true) {
    const { data, error } = await sb.rpc("menu_item_create_shell", { p_item: params.id });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, recipe_id: data, shell: true });
  }

  if (isUuid(body?.recipe_id)) {
    const { data, error } = await sb.rpc("menu_item_bind_recipe", { p_item: params.id, p_recipe: body.recipe_id, p_method: "human", p_score: 1 });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, recipe_id: data });
  }

  return Response.json({ ok: false, error: "recipe_id, accept, shell or unbind required" }, { status: 400 });
}
