import { addDays, isIsoDate, isManager, loadPeople, loadWeek, mondayOf, requireUser } from "@/lib/rota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/rota/week?entity=<uuid>&week=<YYYY-MM-DD>   → the week: shifts, people, budget, live cost
// POST /api/rota/week  { entity_id, week_start, action: "copy_last" | "publish" | "budget", budget_eur?, budget_pct?, forecast_revenue? }
//
// Ruling 1 (budget both ways) lives here: the week carries a budget in EUR or
// as % of forecast revenue; the live planned cost is read beside it.
// Publish is the manager's tick — only then do shifts reach the calendar and
// each person's /me/today (events_src_shift filters status = 'published').

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity_id = String(u.searchParams.get("entity") || "").trim();
  const wk = String(u.searchParams.get("week") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity required" }, { status: 400 });
  const week_start = mondayOf(isIsoDate(wk) ? wk : new Date().toISOString().slice(0, 10));
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const [week, people, mgr] = await Promise.all([loadWeek(sb, entity_id, week_start), loadPeople(sb, entity_id, week_start), isManager(sb, uid, entity_id)]);
  return Response.json({ ok: true, week_start, week_end: addDays(week_start, 6), can_write: mgr, people, ...week });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entity_id = String(body.entity_id || "").trim();
  const action = String(body.action || "");
  if (!entity_id || !isIsoDate(body.week_start)) return Response.json({ ok: false, error: "entity_id + week_start required" }, { status: 400 });
  const week_start = mondayOf(body.week_start);
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  if (!(await isManager(sb, uid, entity_id))) return Response.json({ ok: false, error: "manager required" }, { status: 403 });

  if (action === "copy_last") {
    const { data, error } = await sb.rpc("fn_rota_copy_week", { p_entity: entity_id, p_from_week: addDays(week_start, -7), p_to_week: week_start });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, copied: Number(data || 0) });
  }
  if (action === "publish") {
    const { data, error } = await sb.rpc("fn_rota_publish_week", { p_entity: entity_id, p_week_start: week_start });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, published: Number(data || 0) });
  }
  if (action === "budget") {
    const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number(v));
    const patch: Record<string, unknown> = { entity_id, week_start };
    if ("budget_eur" in body) patch.budget_eur = num(body.budget_eur);
    if ("budget_pct" in body) patch.budget_pct = num(body.budget_pct);
    if ("forecast_revenue" in body) patch.forecast_revenue = num(body.forecast_revenue);
    for (const k of ["budget_eur", "budget_pct", "forecast_revenue"]) if (patch[k] != null && !(Number.isFinite(patch[k] as number) && (patch[k] as number) >= 0)) return Response.json({ ok: false, error: k + " must be a non-negative number" }, { status: 400 });
    const { data, error } = await sb.from("rota_weeks").upsert(patch, { onConflict: "entity_id,week_start" }).select("id, week_start, budget_eur, budget_pct, forecast_revenue, status, published_at").single();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, week: data });
  }
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
}
