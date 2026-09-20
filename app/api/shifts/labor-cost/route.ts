import { supabaseServer } from "@/lib/supabaseServer";
import { entityTimezone, todayInTz, paidMinutes, nextDay, zonedWallClockToUtc } from "@/lib/labor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shifts/labor-cost?entity=<id>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//
// Totals for a date range (inclusive), bucketed in the entity's timezone.
//
// Response:
// {
//   ok, from, to, tz,
//   total_hours, total_cost_eur,
//   by_role:   [{ role, hours, cost_eur, shifts }],
//   by_person: [{ user_id, name, hours, cost_eur, shifts }],
//   unpriced_hours   // hours from shifts with no rate snapshot
// }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity_id = String(searchParams.get("entity") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity query param required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const tz = await entityTimezone(entity_id);
  const today = todayInTz(tz);
  const from = String(searchParams.get("from") || today).trim();
  const to   = String(searchParams.get("to")   || today).trim();

  const startUtc = zonedWallClockToUtc(from + "T00:00:00", tz);
  const endUtc   = zonedWallClockToUtc(nextDay(to) + "T00:00:00", tz);

  const { data: rows, error } = await sb
    .from("labor_shifts")
    .select("id, user_id, role, clock_in, clock_out, break_minutes, hourly_rate_eur")
    .eq("entity_id", entity_id)
    .not("clock_in", "is", null)
    .gte("clock_in", startUtc.toISOString())
    .lt("clock_in", endUtc.toISOString());
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((rows || []).map((r: any) => r.user_id)));
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: members } = await sb
      .from("team_members")
      .select("auth_user_id, name")
      .in("auth_user_id", userIds);
    for (const m of members || []) names.set(m.auth_user_id as string, (m.name as string | null) || null);
  }

  let totalMinutes = 0;
  let totalCost = 0;
  let unpricedMin = 0;

  const byRole = new Map<string, { role: string; minutes: number; cost: number; shifts: number }>();
  const byPerson = new Map<string, { user_id: string; name: string | null; minutes: number; cost: number; shifts: number }>();

  for (const r of (rows || []) as any[]) {
    const minutes = paidMinutes(r.clock_in, r.clock_out, r.break_minutes);
    if (!minutes) continue;
    const rate = r.hourly_rate_eur == null ? null : Number(r.hourly_rate_eur);
    const cost = rate == null ? 0 : (minutes / 60) * rate;

    totalMinutes += minutes;
    totalCost += cost;
    if (rate == null) unpricedMin += minutes;

    const roleKey = (r.role as string | null) || "unassigned";
    const rr = byRole.get(roleKey) || { role: roleKey, minutes: 0, cost: 0, shifts: 0 };
    rr.minutes += minutes; rr.cost += cost; rr.shifts += 1;
    byRole.set(roleKey, rr);

    const pKey = r.user_id as string;
    const pp = byPerson.get(pKey) || { user_id: pKey, name: names.get(pKey) || null, minutes: 0, cost: 0, shifts: 0 };
    pp.minutes += minutes; pp.cost += cost; pp.shifts += 1;
    byPerson.set(pKey, pp);
  }

  return Response.json({
    ok: true,
    from, to, tz,
    total_hours:    round2(totalMinutes / 60),
    total_cost_eur: round2(totalCost),
    unpriced_hours: round2(unpricedMin / 60),
    by_role: Array.from(byRole.values()).map((x) => ({
      role: x.role, hours: round2(x.minutes / 60), cost_eur: round2(x.cost), shifts: x.shifts,
    })).sort((a, b) => b.cost_eur - a.cost_eur),
    by_person: Array.from(byPerson.values()).map((x) => ({
      user_id: x.user_id, name: x.name, hours: round2(x.minutes / 60), cost_eur: round2(x.cost), shifts: x.shifts,
    })).sort((a, b) => b.cost_eur - a.cost_eur),
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
