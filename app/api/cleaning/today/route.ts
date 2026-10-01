import { supabaseServer } from "@/lib/supabaseServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { isIsoDate, isUuid, loadToday } from "@/lib/cleaning/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cleaning/today?entity=<uuid>&date=<YYYY-MM-DD>
//   → today's cleaning runs (materialised from the active templates if the
//     04:50 job has not run yet) with their items. Members of the entity only.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const date = url.searchParams.get("date");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  if (!isIsoDate(date)) return Response.json({ ok: false, error: "date YYYY-MM-DD required" }, { status: 400 });
  const who = await cleaningCaller(entity);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  try {
    const runs = await loadToday(supabaseServer(), entity, date);
    return Response.json({ ok: true, runs, is_manager: who.isManager }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
