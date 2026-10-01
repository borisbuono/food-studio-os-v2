import { isIsoDate, isManager, requireUser } from "@/lib/rota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/rota/shift
//   { action: "upsert", entity_id, id?, person_id, service_date, start_time "HH:MM", end_time "HH:MM", role?, station?, area?, notes? }
//   { action: "move",   entity_id, id, service_date?, person_id? }         — drag to another day / person
//   { action: "cancel", entity_id, id }                                     — soft delete (keeps the row for settlements)
//   { action: "delete", entity_id, id }                                     — hard delete, draft shifts only
// Managers only. planned_minutes + hourly_cost snapshot are set by the row trigger.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const entity_id = String(body.entity_id || "").trim();
  const action = String(body.action || "upsert");
  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  if (!(await isManager(sb, uid, entity_id))) return Response.json({ ok: false, error: "manager required" }, { status: 403 });

  const sel = "id, entity_id, person_id, service_date, start_time, end_time, role, station, area, planned_minutes, hourly_cost, status, notes";

  if (action === "cancel" || action === "delete") {
    const id = String(body.id || "");
    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    if (action === "delete") {
      const { error } = await sb.from("rota_shifts").delete().eq("id", id).eq("entity_id", entity_id).eq("status", "planned");
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    }
    const { data, error } = await sb.from("rota_shifts").update({ status: "cancelled" }).eq("id", id).eq("entity_id", entity_id).select(sel).single();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, shift: data });
  }

  if (action === "move") {
    const id = String(body.id || "");
    const patch: Record<string, unknown> = {};
    if (isIsoDate(body.service_date)) patch.service_date = body.service_date;
    if (body.person_id) patch.person_id = String(body.person_id);
    if (!id || !Object.keys(patch).length) return Response.json({ ok: false, error: "id + service_date|person_id required" }, { status: 400 });
    const { data, error } = await sb.from("rota_shifts").update(patch).eq("id", id).eq("entity_id", entity_id).select(sel).single();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, shift: data });
  }

  // upsert
  const person_id = String(body.person_id || "").trim();
  const start_time = String(body.start_time || "").slice(0, 5);
  const end_time = String(body.end_time || "").slice(0, 5);
  if (!person_id || !isIsoDate(body.service_date) || !HHMM.test(start_time) || !HHMM.test(end_time)) {
    return Response.json({ ok: false, error: "person_id, service_date, start_time HH:MM, end_time HH:MM required" }, { status: 400 });
  }
  const area = ["foh", "boh", "other"].includes(body.area) ? body.area : undefined;
  const row: Record<string, unknown> = {
    entity_id, person_id, service_date: body.service_date, start_time, end_time,
    role: body.role ? String(body.role).slice(0, 40) : null,
    station: body.station ? String(body.station).slice(0, 40) : null,
    notes: body.notes ? String(body.notes).slice(0, 300) : null,
  };
  if (area) row.area = area;
  if (body.id) {
    const { data, error } = await sb.from("rota_shifts").update(row).eq("id", String(body.id)).eq("entity_id", entity_id).select(sel).single();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, shift: data });
  }
  const { data, error } = await sb.from("rota_shifts").insert({ ...row, created_by: uid }).select(sel).single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, shift: data });
}
