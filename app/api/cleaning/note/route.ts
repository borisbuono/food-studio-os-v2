import { supabaseServer } from "@/lib/supabaseServer";
import { isUuid } from "@/lib/cleaning/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cleaning/note { item_id, note }
//   A reason on a line (why it was not done, what was done about a reading).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const item_id = body?.item_id;
  if (!isUuid(item_id)) return Response.json({ ok: false, error: "item_id required" }, { status: 400 });
  const note = String(body?.note ?? "").slice(0, 500);
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("cleaning_note", { p_item: item_id, p_note: note });
  if (error) return Response.json({ ok: false, error: error.message }, { status: /signed|member/.test(error.message) ? 403 : 500 });
  return Response.json({ ok: true, item: data });
}
