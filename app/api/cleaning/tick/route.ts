import { supabaseServer } from "@/lib/supabaseServer";
import { isUuid } from "@/lib/cleaning/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cleaning/tick { item_id, done?: boolean, note?: string }
//   One tap = done, by me, now. done=false is the undo (within the 10 s the
//   screen offers, or later while the run is still open). The RPC stamps
//   done_by / done_by_name from auth.uid() — the client cannot name anyone.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const item_id = body?.item_id;
  if (!isUuid(item_id)) return Response.json({ ok: false, error: "item_id required" }, { status: 400 });
  const done = body?.done === undefined ? true : !!body.done;
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("cleaning_tick", { p_item: item_id, p_done: done, p_note: note });
  if (error) return Response.json({ ok: false, error: error.message }, { status: /signed|member/.test(error.message) ? 403 : 500 });
  return Response.json({ ok: true, item: data });
}
