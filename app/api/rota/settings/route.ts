import { isIsoDate, isManager, loadPeople, requireUser, type RotaSettings } from "@/lib/rota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota S5 — Team › Rota › Settings (2026-10-01).
// GET  /api/rota/settings?entity=<uuid>
//      → settings row, people with their current rate, special days, holidays the OS knows for this entity (S7)
// POST /api/rota/settings { entity_id, action: "settings", patch: {...} }            → fn_rota_settings_save
//      /api/rota/settings { entity_id, action: "rate", person_id, rate, from?, role? } → fn_rota_rate_set (labor_hourly_rates with person_id)
//      /api/rota/settings { entity_id, action: "special_add", date, name, kind?, uplift?, notes? }
//      /api/rota/settings { entity_id, action: "special_delete", id }
// Every write is a manager's tick, re-checked server-side in the RPC / by RLS.

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity_id = String(u.searchParams.get("entity") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity required" }, { status: 400 });
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  const [settingsRes, people, specialRes, mgr, entRes] = await Promise.all([
    sb.rpc("fn_rota_settings", { p_entity: entity_id }),
    loadPeople(sb, entity_id, today),
    sb.from("entity_special_days").select("id, date, name, kind, uplift, notes").eq("entity_id", entity_id).gte("date", today).order("date").limit(200),
    isManager(sb, uid, entity_id),
    sb.from("entities").select("country_code, city, metadata").eq("id", entity_id).maybeSingle(),
  ]);
  // Holidays the forecast will use (S7): national + region + municipality from holiday_calendar, plus the house's special days
  const { data: hol } = await sb.rpc("fn_entity_holidays", { p_entity: entity_id, p_from: today, p_to: addDays(today, 365) });
  const holidays: any[] = Array.isArray(hol) ? hol : [];
  const s = (Array.isArray(settingsRes.data) ? settingsRes.data[0] : settingsRes.data) as any;
  const settings: RotaSettings & { holiday_region: string | null; holiday_local: string | null } = {
    overtime_rate: Number(s?.overtime_rate ?? 1.25), tolerance_minutes: Number(s?.tolerance_minutes ?? 10),
    default_budget_pct: s?.default_budget_pct == null ? null : Number(s.default_budget_pct),
    staffing_bands: Array.isArray(s?.staffing_bands) ? s.staffing_bands : [],
    weekly_budget_eur: s?.weekly_budget_eur == null ? null : Number(s.weekly_budget_eur),
    spend_per_cover: s?.spend_per_cover == null ? null : Number(s.spend_per_cover),
    lunch_share: Number(s?.lunch_share ?? 0.4),
    holiday_uplift: s?.holiday_uplift && typeof s.holiday_uplift === "object" ? s.holiday_uplift : { national: 1.15, regional: 1.15, local: 1.3, special: 1.4 },
    holiday_region: s?.holiday_region || null, holiday_local: s?.holiday_local || null,
  };
  return Response.json({ ok: true, can_write: mgr, settings, people, special_days: specialRes.data || [], holidays, entity: entRes.data || null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const entity_id = String(body.entity_id || "").trim();
  const action = String(body.action || "");
  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  if (!(await isManager(sb, uid, entity_id))) return Response.json({ ok: false, error: "manager required" }, { status: 403 });

  if (action === "settings") {
    const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
    const { data, error } = await sb.rpc("fn_rota_settings_save", { p_entity: entity_id, p_patch: patch });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
    return Response.json({ ok: true, settings: Array.isArray(data) ? data[0] : data });
  }
  if (action === "rate") {
    const person_id = String(body.person_id || "");
    const rate = Number(body.rate);
    if (!person_id || !Number.isFinite(rate) || rate < 0) return Response.json({ ok: false, error: "person_id + rate >= 0 required" }, { status: 400 });
    const { data, error } = await sb.rpc("fn_rota_rate_set", { p_entity: entity_id, p_person: person_id, p_rate: rate, p_from: isIsoDate(body.from) ? body.from : null, p_role: body.role ? String(body.role).slice(0, 40) : null });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
    return Response.json({ ok: true, rate: Array.isArray(data) ? data[0] : data });
  }
  if (action === "special_add") {
    const name = String(body.name || "").trim().slice(0, 80);
    if (!isIsoDate(body.date) || !name) return Response.json({ ok: false, error: "date + name required" }, { status: 400 });
    const kind = ["special", "closed", "quiet"].includes(body.kind) ? body.kind : "special";
    const uplift = body.uplift === "" || body.uplift == null ? null : Number(body.uplift);
    if (uplift != null && !(Number.isFinite(uplift) && uplift >= 0 && uplift <= 5)) return Response.json({ ok: false, error: "uplift must be 0–5 (e.g. 1.4 = +40 %)" }, { status: 400 });
    const { data, error } = await sb.from("entity_special_days").upsert({ entity_id, date: body.date, name, kind, uplift, notes: body.notes ? String(body.notes).slice(0, 200) : null, created_by: uid }, { onConflict: "entity_id,date,name" }).select("id, date, name, kind, uplift, notes").single();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, day: data });
  }
  if (action === "special_delete") {
    const id = String(body.id || "");
    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const { error } = await sb.from("entity_special_days").delete().eq("id", id).eq("entity_id", entity_id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
}

function addDays(iso: string, n: number): string { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
