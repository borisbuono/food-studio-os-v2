import { supabaseServer } from "@/lib/supabaseServer";
import { entityTimezone, todayInTz, paidMinutes, nextDay, zonedWallClockToUtc } from "@/lib/labor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shifts/day?entity=<id>&date=<YYYY-MM-DD>
//
// Full shift log for a single business day, bucketed in the entity's
// timezone. A shift counts to the day it was clocked in (fallback to
// scheduled_start when no clock_in — planned but unattended).
//
// Response: { ok, date, tz, shifts: [ { id, user_id, name, role, station,
//   clock_in, clock_out, scheduled_start, scheduled_end, break_minutes,
//   hourly_rate_eur, paid_minutes, cost_eur } ] }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity_id = String(searchParams.get("entity") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity query param required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const tz = await entityTimezone(entity_id);
  const date = String(searchParams.get("date") || todayInTz(tz)).trim();

  // day range in the entity's tz → utc bounds. The Intl formatter above
  // gives us YYYY-MM-DD; convert those local midnights to a UTC ISO by
  // asking JS what that wallclock is in UTC.
  const startUtc = zonedWallClockToUtc(date + "T00:00:00", tz);
  const endUtc   = zonedWallClockToUtc(nextDay(date) + "T00:00:00", tz);

  const { data: rows, error } = await sb
    .from("labor_shifts")
    .select("id, user_id, role, station, clock_in, clock_out, scheduled_start, scheduled_end, break_minutes, hourly_rate_eur, notes")
    .eq("entity_id", entity_id)
    // A shift is "on that day" if either clock_in OR scheduled_start falls
    // in the range. Two `or` clauses because .or() strings are painful.
    .or(
      `and(clock_in.gte.${startUtc.toISOString()},clock_in.lt.${endUtc.toISOString()}),` +
      `and(clock_in.is.null,scheduled_start.gte.${startUtc.toISOString()},scheduled_start.lt.${endUtc.toISOString()})`
    )
    .order("clock_in", { ascending: true, nullsFirst: true })
    .order("scheduled_start", { ascending: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((rows || []).map((r: any) => r.user_id)));
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length) {
    const { data: members } = await sb
      .from("team_members")
      .select("auth_user_id, name, email")
      .in("auth_user_id", userIds);
    for (const m of members || []) {
      names.set(m.auth_user_id as string, { name: m.name as string | null, email: m.email as string | null });
    }
  }

  const shifts = (rows || []).map((r: any) => {
    const minutes = paidMinutes(r.clock_in, r.clock_out, r.break_minutes);
    const rate = r.hourly_rate_eur == null ? null : Number(r.hourly_rate_eur);
    return {
      ...r,
      name: names.get(r.user_id)?.name || null,
      email: names.get(r.user_id)?.email || null,
      paid_minutes: minutes,
      cost_eur: rate == null ? null : Math.round((minutes / 60) * rate * 100) / 100,
    };
  });

  return Response.json({ ok: true, date, tz, shifts });
}

