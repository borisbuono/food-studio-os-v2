import { supabaseServer } from "@/lib/supabaseServer";
import { isUuid } from "@/lib/cleaning/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cleaning/temp { item_id, temperature_c }
//   A fridge / freezer reading on a temperature line (cleaning S2). The RPC
//   writes haccp_temperature_logs (reused), marks the line done by me, and —
//   when the reading is outside the band — adds a corrective-action line that
//   blocks the sign-off until it carries a note.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const item_id = body?.item_id;
  const temp = Number(String(body?.temperature_c ?? "").replace(",", "."));
  if (!isUuid(item_id)) return Response.json({ ok: false, error: "item_id required" }, { status: 400 });
  if (!Number.isFinite(temp)) return Response.json({ ok: false, error: "temperature_c required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("cleaning_temp", { p_item: item_id, p_temp: temp });
  if (error) return Response.json({ ok: false, error: error.message }, { status: /signed|member/.test(error.message) ? 403 : /bounds|not a temperature/.test(error.message) ? 400 : 500 });
  return Response.json({ ok: true, item: data });
}
