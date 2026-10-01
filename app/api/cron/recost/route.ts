import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cronAuthorized, cronDb, startRun, finishRun } from "@/lib/cron/heartbeat";
import { fillProvisional } from "@/lib/menu/provisional";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET|POST /api/cron/recost — nightly re-cost as albaranes land.
//   Bearer CRON_SECRET. pg_cron already runs fn_recost_all() at 01:40 UTC
//   (Vercel Hobby cron slots are full); this route is the same job plus the
//   Haiku provisional-price fill, for GitHub Actions / a hand run. Order:
//   prices → menu → every other recipe (in SQL), then provisional fill per
//   venue, then the menu once more so new estimates show tonight.

async function run(req: NextRequest) {
  const auth = await cronAuthorized(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.who }, { status: 401 });
  const { sb, mode } = cronDb();
  if (mode !== "service") return NextResponse.json({ ok: false, error: "skipped: no service key" }, { status: 500 });
  const runId = await startRun("recost", auth.who);
  try {
    const all = await sb.rpc("fn_recost_all");
    if (all.error) throw new Error(all.error.message);
    const { data: venues } = await sb.from("entities").select("id, slug").eq("entity_type", "operating_venue").eq("is_active", true);
    const provisional: Record<string, any> = {};
    for (const v of (venues || []) as any[]) {
      const p = await fillProvisional(sb, v.id);
      provisional[v.slug] = p;
      if (p.written > 0) await sb.rpc("fn_recost_entity", { p_entity: v.id, p_scope: "menu" });
    }
    const detail = { recost: all.data, provisional };
    await finishRun(runId, true, detail);
    return NextResponse.json({ ok: true, ...detail });
  } catch (e: any) {
    await finishRun(runId, false, null, String(e?.message || e));
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
