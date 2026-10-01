import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/menu/prices/[id]/confirm  body { price_eur?, unit? }
//   Boris's tick on a provisional price: as is (no body) or corrected. The row
//   becomes source='confirmed'; the venue's menu is re-costed so the number on
//   the page moves in the same tap.
function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const price = body?.price_eur == null || body.price_eur === "" ? null : Number(body.price_eur);
  if (price != null && (!Number.isFinite(price) || price < 0)) return Response.json({ ok: false, error: "price must be a number ≥ 0" }, { status: 400 });
  const unit = ["kg", "l", "pcs"].includes(body?.unit) ? body.unit : null;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("ingredient_price_confirm", { p_id: params.id, p_price: price, p_unit: unit });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return Response.json({ ok: false, error: "not allowed" }, { status: 403 });
  await sb.rpc("fn_recost_entity", { p_entity: row.entity_id, p_scope: "menu" });
  return Response.json({ ok: true, price: row });
}
