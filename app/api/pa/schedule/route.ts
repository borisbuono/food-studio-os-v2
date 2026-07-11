import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/pa/schedule  → { state } (upserts a row if none exists)
// PATCH /api/pa/schedule Body: partial fields — updates the singleton row.
export async function GET() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: existing } = await sb.from("pa_schedule_state").select("*").eq("user_id", uid).maybeSingle();
  if (existing) return Response.json({ ok: true, state: existing });

  const { data, error } = await sb.from("pa_schedule_state").insert({ user_id: uid }).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, state: data });
}

export async function PATCH(req: Request) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: any = { updated_at: new Date().toISOString() };
  const allow = [
    "timezone",
    "whatsapp_triage_hourly",
    "whatsapp_triage_window_start",
    "whatsapp_triage_window_end",
    "morning_brief_time",
    "evening_debrief_time",
    "daily_academy_time",
  ];
  for (const k of allow) if (body[k] !== undefined) patch[k] = body[k];

  // Upsert.
  const { data, error } = await sb
    .from("pa_schedule_state")
    .upsert({ user_id: uid, ...patch }, { onConflict: "user_id" })
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, state: data });
}
