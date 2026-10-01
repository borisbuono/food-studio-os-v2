import { supabaseServer } from "@/lib/supabaseServer";
import { isUuid } from "@/lib/cleaning/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cleaning/sign { run_id }
//   The responsible person's sign-off. Managers only (fn_is_entity_manager in
//   the RPC); refused while a corrective action is unanswered (S2). The run
//   is closed afterwards — no more ticks.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const run_id = body?.run_id;
  if (!isUuid(run_id)) return Response.json({ ok: false, error: "run_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("cleaning_sign", { p_run: run_id });
  if (error) {
    const m = error.message || "";
    const status = /managers only/.test(m) ? 403 : /corrective/.test(m) ? 409 : 500;
    return Response.json({ ok: false, error: m }, { status });
  }
  return Response.json({ ok: true, run: data });
}
