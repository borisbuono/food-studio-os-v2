import { addDays, isIsoDate, isManager, mondayOf, requireUser } from "@/lib/rota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/rota/settlements?entity=<uuid>&week=<YYYY-MM-DD>
//      → pending exceptions (the Overtime queue, any date) + this week's settled rows + week labour totals
// POST /api/rota/settlements { id, kind: "overtime"|"undertime", decision: "approve"|"reject"|"adjust", minutes?, note? }
//      → the manager's tick. fn_settlement_decide re-checks the manager role and
//        recomputes paid_minutes / paid_eur; approved overtime at the entity's overtime_rate.
//
// Ruling 3: nothing in shift_settlements changes status without this call.
// Staff rows are visible to managers and to the person themselves (RLS).

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity_id = String(u.searchParams.get("entity") || "").trim();
  const wk = String(u.searchParams.get("week") || "");
  if (!entity_id) return Response.json({ ok: false, error: "entity required" }, { status: 400 });
  const week_start = mondayOf(isIsoDate(wk) ? wk : new Date().toISOString().slice(0, 10));
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const sel = "id, rota_shift_id, person_id, service_date, kind, planned_minutes, worked_minutes, clock_in, clock_out, hourly_cost, overtime_rate, tolerance_minutes, early_minutes, late_end_minutes, late_start_minutes, early_end_minutes, overtime_minutes, undertime_minutes, overtime_status, overtime_approved_minutes, undertime_status, undertime_approved_minutes, paid_minutes, paid_eur, overtime_eur, decided_at, note";
  const [pendRes, weekRes, labourRes, mgr] = await Promise.all([
    sb.from("shift_settlements").select(sel).eq("entity_id", entity_id).or("overtime_status.eq.pending,undertime_status.eq.pending").order("service_date", { ascending: false }).limit(200),
    sb.from("shift_settlements").select(sel).eq("entity_id", entity_id).gte("service_date", week_start).lt("service_date", addDays(week_start, 7)).order("service_date", { ascending: false }).limit(300),
    sb.rpc("fn_rota_week_labour", { p_entity: entity_id, p_week_start: week_start }),
    isManager(sb, uid, entity_id),
  ]);
  const ids = Array.from(new Set([...(pendRes.data || []), ...(weekRes.data || [])].map((r: any) => r.person_id).filter(Boolean)));
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await sb.from("team_members").select("id, name").in("id", ids);
    for (const t of data || []) names[(t as any).id] = (t as any).name || "—";
  }
  const l = Array.isArray(labourRes.data) ? labourRes.data[0] : labourRes.data;
  return Response.json({ ok: true, week_start, can_write: mgr, pending: pendRes.data || [], week: weekRes.data || [], names, labour: l || null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "");
  const kind = String(body.kind || "");
  const decision = String(body.decision || "");
  if (!id || !["overtime", "undertime"].includes(kind) || !["approve", "reject", "adjust"].includes(decision)) {
    return Response.json({ ok: false, error: "id, kind overtime|undertime, decision approve|reject|adjust required" }, { status: 400 });
  }
  const minutes = decision === "adjust" ? Math.max(0, Math.round(Number(body.minutes || 0))) : null;
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.rpc("fn_settlement_decide", { p_id: id, p_kind: kind, p_decision: decision, p_minutes: minutes, p_note: body.note ? String(body.note).slice(0, 300) : null });
  if (error) return Response.json({ ok: false, error: error.message }, { status: error.message.includes("manager") ? 403 : 500 });
  return Response.json({ ok: true, settlement: data });
}
