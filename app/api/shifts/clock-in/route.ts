import { supabaseServer } from "@/lib/supabaseServer";
import { currentRateFor, entityTimezone, todayInTz } from "@/lib/labor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/shifts/clock-in
//
// Body: { entity_id: uuid, user_id?: uuid, role?: string, station?: string }
//
// Semantics:
//   * `user_id` defaults to auth.uid (self clock-in from the kiosk).
//   * A manager can pass a different `user_id` to clock somebody else in.
//   * We refuse a second concurrent clock-in for the same user (there must
//     be no open row for them on this entity).
//   * The hourly rate is snapshotted from `labor_hourly_rates` as of the
//     entity's "today" — that snapshot is immutable on the shift row.
//
// Response: { ok, shift: { id, clock_in, hourly_rate_eur, role, ... } }

type Body = {
  entity_id?: string;
  user_id?: string;
  role?: string;
  station?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const entity_id = String(body.entity_id || "").trim();
  const role      = body.role    ? String(body.role).trim().slice(0, 40)    : null;
  const station   = body.station ? String(body.station).trim().slice(0, 40) : null;

  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const authUid = u.user?.id;
  if (!authUid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const target_user_id = String(body.user_id || authUid).trim();

  // If the caller is trying to clock someone else in, require them to be a
  // manager on this entity. RLS will re-enforce, but a friendlier error
  // beats a 42501.
  if (target_user_id !== authUid) {
    const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid: authUid, ent: entity_id });
    if (!mgr) return Response.json({ ok: false, error: "manager required to clock someone else in" }, { status: 403 });
  }

  // Refuse a duplicate open shift for the same user.
  const { data: openRows } = await sb
    .from("labor_shifts")
    .select("id")
    .eq("entity_id", entity_id)
    .eq("user_id", target_user_id)
    .is("clock_out", null)
    .not("clock_in", "is", null)
    .limit(1);
  if (openRows && openRows.length) {
    return Response.json({ ok: false, error: "already clocked in", shift_id: openRows[0].id }, { status: 409 });
  }

  const tz = await entityTimezone(entity_id);
  const today = todayInTz(tz);
  const rate = await currentRateFor(entity_id, target_user_id, today);

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await sb
    .from("labor_shifts")
    .insert({
      entity_id,
      user_id: target_user_id,
      role,
      station,
      clock_in: nowIso,
      clock_in_by: authUid,
      hourly_rate_eur: rate,
    })
    .select("id, entity_id, user_id, role, station, clock_in, clock_in_by, hourly_rate_eur")
    .single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, shift: inserted });
}
