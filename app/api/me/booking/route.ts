import { supabaseServer } from "@/lib/supabaseServer";
import { myPersonIds } from "@/lib/calendar.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/me/booking → my booking profile (or null)
// PUT  /api/me/booking → create/update it. RLS: own row, venue must be one of mine.
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export async function GET() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const ids = await myPersonIds();
  if (!ids.length) return Response.json({ ok: true, profile: null, person_id: null });
  const { data } = await sb.from("booking_profiles").select("*").in("person_id", ids).limit(1).maybeSingle();
  return Response.json({ ok: true, profile: data || null, person_id: ids[0] });
}

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as any;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const ids = await myPersonIds();
  if (!ids.length) return Response.json({ ok: false, error: "no team member for this login" }, { status: 403 });
  const slug = String(b.slug || "").toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return Response.json({ ok: false, error: "slug: lowercase letters, digits, dashes" }, { status: 400 });
  const hours: Record<string, [string, string][]> = {};
  for (const k of WEEK) {
    const ws = Array.isArray(b.hours?.[k]) ? b.hours[k] : [];
    hours[k] = ws.filter((w: any) => Array.isArray(w) && HHMM.test(w[0]) && HHMM.test(w[1]) && w[0] < w[1]).slice(0, 4);
  }
  const row = {
    person_id: ids[0], slug, entity_id: String(b.entity_id || ""),
    display_name: String(b.display_name || "").trim().slice(0, 80) || "—",
    intro: b.intro ? String(b.intro).slice(0, 500) : null,
    slot_minutes: Math.min(240, Math.max(10, Number(b.slot_minutes) || 30)),
    buffer_minutes: Math.min(120, Math.max(0, Number(b.buffer_minutes) || 0)),
    min_notice_hours: Math.min(336, Math.max(0, Number(b.min_notice_hours) || 0)),
    days_ahead: Math.min(60, Math.max(1, Number(b.days_ahead) || 14)),
    hours, location: b.location ? String(b.location).slice(0, 200) : null,
    active: b.active !== false, updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from("booking_profiles").upsert(row, { onConflict: "person_id" }).select("*").single();
  if (error) {
    const msg = error.code === "23505" ? "that link is taken" : error.message;
    return Response.json({ ok: false, error: msg }, { status: error.code === "42501" ? 403 : 400 });
  }
  return Response.json({ ok: true, profile: data });
}
