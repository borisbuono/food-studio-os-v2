import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/menu/prices?entity=<uuid>&only=confirm
//   → the venue's ingredient prices; only=confirm → the provisional ones that
//     still need Boris's tick, most-used-on-the-menu first.
function isUuid(x: string | null): x is string {
  return !!x && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const only = url.searchParams.get("only");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  let q = sb.from("ingredient_prices").select("id, canonical_name, unit, price_eur, source, needs_confirm, price_asof, sample_count, supplier, note, unit_weight_kg").eq("entity_id", entity).order("canonical_name");
  if (only === "confirm") q = q.eq("needs_confirm", true);
  const { data, error } = await q.limit(500);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  // how many menu lines lean on each price → confirm the ones that matter first
  const ids = (data || []).map((r: any) => r.id);
  const uses = new Map<string, number>();
  if (ids.length) {
    const { data: lines } = await sb.from("recipe_ingredients").select("price_id").in("price_id", ids).limit(5000);
    for (const l of (lines || []) as any[]) uses.set(l.price_id, (uses.get(l.price_id) || 0) + 1);
  }
  const rows = (data || []).map((r: any) => ({ ...r, price_eur: Number(r.price_eur), uses: uses.get(r.id) || 0 }))
    .sort((a: any, b: any) => b.uses - a.uses || a.canonical_name.localeCompare(b.canonical_name));
  return Response.json({ ok: true, prices: rows });
}
