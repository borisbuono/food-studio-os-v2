import type { NextRequest } from "next/server";
import { cronAuthorized, cronDb, startRun, finishRun } from "@/lib/cron/heartbeat";
import { hasServiceRole } from "@/lib/supabaseJob";
import { syncAllConnected } from "@/lib/calendarGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Google Calendar pull for everyone connected. NOT registered in vercel.json:
// Hobby allows two cron entries and both are taken, so the nightly pull rides
// on /api/cron/pos-nightly. This route stays for manual runs and for the day
// the cron budget changes.
export async function GET(req: NextRequest) {
  const auth = await cronAuthorized(req);
  if (!auth.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  const runId = await startRun("calendar-google", auth.who);
  const { sb, mode } = cronDb();
  const res = await syncAllConnected(sb);
  await finishRun(runId, res.ok, res);
  return Response.json({ db: mode, ...res });
}
