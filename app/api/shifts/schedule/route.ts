import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/shifts/schedule
//
// Create a scheduled shift (planning — no clock_in yet).
//
// Body: { entity_id, user_id, role?, station?, scheduled_start (ISO),
//   scheduled_end (ISO), notes? }
//
// Requires the caller to be a manager/owner on the entity.

type Body = {
  entity_id?: string;
  user_id?: string;
  role?: string;
  station?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  notes?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const entity_id       = String(body.entity_id || "").trim();
  const user_id         = String(body.user_id   || "").trim();
  const scheduled_start = body.scheduled_start ? new Date(body.scheduled_start) : null;
  const scheduled_end   = body.scheduled_end   ? new Date(body.scheduled_end)   : null;

  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!user_id)   return Response.json({ ok: false, error: "user_id required"   }, { status: 400 });
  if (!scheduled_start || isNaN(scheduled_start.getTime())) {
    return Response.json({ ok: false, error: "scheduled_start required (ISO)" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const authUid = u.user?.id;
  if (!authUid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid: authUid, ent: entity_id });
  if (!mgr) return Response.json({ ok: false, error: "manager required to schedule shifts" }, { status: 403 });

  const { data: inserted, error } = await sb
    .from("labor_shifts")
    .insert({
      entity_id,
      user_id,
      role: body.role    ? String(body.role).trim().slice(0, 40)    : null,
      station: body.station ? String(body.station).trim().slice(0, 40) : null,
      scheduled_start: scheduled_start.toISOString(),
      scheduled_end: scheduled_end && !isNaN(scheduled_end.getTime()) ? scheduled_end.toISOString() : null,
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
    })
    .select("id, entity_id, user_id, role, station, scheduled_start, scheduled_end, notes")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, shift: inserted });
}
