import { supabaseServer } from "@/lib/supabaseServer";
import { GCAL_STALE_MS, syncPerson, type GcalTokens } from "@/lib/calendarGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/calendar/google/sync → { connected, email, last_synced_at, last_error, stale }
// POST /api/calendar/google/sync[?force=1] → pull my Google calendar now (skips if fresh)
export async function GET() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data } = await sb.from("google_calendar_tokens")
    .select("google_email, connected_at, last_synced_at, last_error").eq("auth_user_id", u.user.id).maybeSingle();
  const row: any = data;
  return Response.json({
    ok: true, configured: !!process.env.GOOGLE_OAUTH_CLIENT_ID, connected: !!row,
    email: row?.google_email || null, last_synced_at: row?.last_synced_at || null, last_error: row?.last_error || null,
    stale: !row?.last_synced_at || Date.now() - Date.parse(row.last_synced_at) > GCAL_STALE_MS,
  });
}

export async function POST(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: rows } = await sb.rpc("gcal_my_tokens");
  const t = ((rows as any[]) || [])[0] as GcalTokens | undefined;
  if (!t) return Response.json({ ok: false, error: "not connected" }, { status: 404 });
  if (!force && t.last_synced_at && Date.now() - Date.parse(t.last_synced_at) < GCAL_STALE_MS)
    return Response.json({ ok: true, skipped: "fresh" });
  const res = await syncPerson(sb as any, t);
  return Response.json(res, { status: res.ok ? 200 : 502 });
}
