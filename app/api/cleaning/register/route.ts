import { supabaseServer } from "@/lib/supabaseServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { isUuid, loadRuns } from "@/lib/cleaning/server";
import { monthBounds } from "@/lib/cleaning/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cleaning/register?entity=<uuid>&month=YYYY-MM&area=<text?>
//   → the month's runs with items (members). Runs are kept 2 years minimum —
//     nothing here deletes.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const month = String(url.searchParams.get("month") || "");
  const area = url.searchParams.get("area") || null;
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  const b = monthBounds(month);
  if (!b) return Response.json({ ok: false, error: "month YYYY-MM required" }, { status: 400 });
  const who = await cleaningCaller(entity);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  try {
    const runs = await loadRuns(supabaseServer(), entity, b.from, b.to, { area });
    return Response.json({ ok: true, runs }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) { return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
}
