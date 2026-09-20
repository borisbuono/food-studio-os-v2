import Link from "next/link";
import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import { supabaseServer } from "@/lib/supabaseServer";
import { entityTimezone, todayInTz, paidMinutes, nextDay, zonedWallClockToUtc, elapsedLabel } from "@/lib/labor";
import RateManager from "./RateManager";
import ExportButton from "./ExportButton";

export const dynamic = "force-dynamic";

// /h/<slug>/office/labor — admin dashboard.
// Today's live floor · today's shift log · week aggregates · rate management.

type ShiftRow = {
  id: string; user_id: string; role: string | null; station: string | null;
  clock_in: string | null; clock_out: string | null;
  scheduled_start: string | null; scheduled_end: string | null;
  break_minutes: number | null; hourly_rate_eur: number | null;
};

function eur(n: number): string { return "€" + n.toFixed(2); }

export default async function LaborPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const entity_id = entityForHouseSlug(slug);
  if (!entity_id) redirect("/studio");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/labor`);

  const tz = await entityTimezone(entity_id);
  const today = todayInTz(tz);

  // Week bounds — the 7 days ending today (inclusive).
  const weekStart = shiftDate(today, -6);

  // Manager check (drives Rate manager write-affordance).
  const { data: mgrRes } = await sb.rpc("fn_is_entity_manager", { uid: u.user.id, ent: entity_id });
  const canWrite = Boolean(mgrRes);

  // Today's shifts (any row whose clock_in or scheduled_start bucketed to
  // today in the entity's tz). Reuses the same window logic as the API.
  const todayStart = zonedWallClockToUtc(today + "T00:00:00", tz);
  const todayEnd   = zonedWallClockToUtc(nextDay(today) + "T00:00:00", tz);
  const weekStartUtc = zonedWallClockToUtc(weekStart + "T00:00:00", tz);

  const [todaysRes, weekRes, ratesRes, membershipsRes] = await Promise.all([
    sb.from("labor_shifts")
      .select("id, user_id, role, station, clock_in, clock_out, scheduled_start, scheduled_end, break_minutes, hourly_rate_eur")
      .eq("entity_id", entity_id)
      .or(
        `and(clock_in.gte.${todayStart.toISOString()},clock_in.lt.${todayEnd.toISOString()}),` +
        `and(clock_in.is.null,scheduled_start.gte.${todayStart.toISOString()},scheduled_start.lt.${todayEnd.toISOString()})`
      )
      .order("clock_in", { ascending: true, nullsFirst: true }),
    sb.from("labor_shifts")
      .select("id, user_id, role, clock_in, clock_out, break_minutes, hourly_rate_eur")
      .eq("entity_id", entity_id)
      .not("clock_in", "is", null)
      .gte("clock_in", weekStartUtc.toISOString())
      .lt("clock_in", todayEnd.toISOString()),
    sb.from("labor_hourly_rates")
      .select("user_id, role, hourly_rate_eur, effective_from, effective_to")
      .eq("entity_id", entity_id)
      .lte("effective_from", today)
      .order("effective_from", { ascending: false }),
    sb.from("memberships")
      .select("person_id, role")
      .eq("entity_id", entity_id)
      .eq("status", "active"),
  ]);

  // Hydrate names for every user_id in this page.
  const userIds = new Set<string>();
  for (const r of (todaysRes.data || []) as any[]) userIds.add(r.user_id);
  for (const r of (weekRes.data   || []) as any[]) userIds.add(r.user_id);
  for (const r of (ratesRes.data  || []) as any[]) userIds.add(r.user_id);

  const personIds = Array.from(new Set((membershipsRes.data || []).map((r: any) => r.person_id as string)));
  const roleByPerson = new Map<string, string | null>();
  for (const r of membershipsRes.data || []) roleByPerson.set(r.person_id as string, (r as any).role || null);

  const rosterAll = personIds.length
    ? await sb.from("team_members")
        .select("id, auth_user_id, name, email, default_role, status")
        .in("id", personIds)
    : { data: [] as any[] };

  const nameByAuth = new Map<string, { name: string | null; email: string | null }>();
  const roster: Array<{ auth_user_id: string; name: string | null; email: string | null; role: string | null }> = [];
  for (const m of (rosterAll.data || []) as any[]) {
    if (!m.auth_user_id) continue;
    nameByAuth.set(m.auth_user_id, { name: m.name || null, email: m.email || null });
    if (m.status !== "archived") {
      roster.push({
        auth_user_id: m.auth_user_id,
        name: m.name || null,
        email: m.email || null,
        role: (roleByPerson.get(m.id) as string | null) || m.default_role || null,
      });
    }
  }
  roster.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));

  // Enrich today's rows with paid_minutes + cost + name for the table.
  const todaysRows = ((todaysRes.data || []) as ShiftRow[]).map((r) => {
    const minutes = paidMinutes(r.clock_in, r.clock_out, r.break_minutes);
    const rate = r.hourly_rate_eur == null ? null : Number(r.hourly_rate_eur);
    return {
      ...r,
      name: nameByAuth.get(r.user_id)?.name || null,
      email: nameByAuth.get(r.user_id)?.email || null,
      paid_minutes: minutes,
      cost_eur: rate == null ? null : Math.round((minutes / 60) * rate * 100) / 100,
    };
  });

  const liveNow = todaysRows.filter((r) => r.clock_in && !r.clock_out);

  // Week aggregates.
  let weekMinutes = 0, weekCost = 0;
  const wByPerson = new Map<string, { name: string | null; minutes: number; cost: number; shifts: number }>();
  const wByRole   = new Map<string, { minutes: number; cost: number; shifts: number }>();
  for (const r of (weekRes.data || []) as any[]) {
    const minutes = paidMinutes(r.clock_in, r.clock_out, r.break_minutes);
    if (!minutes) continue;
    const rate = r.hourly_rate_eur == null ? null : Number(r.hourly_rate_eur);
    const cost = rate == null ? 0 : (minutes / 60) * rate;
    weekMinutes += minutes;
    weekCost += cost;
    const pKey = r.user_id;
    const pp = wByPerson.get(pKey) || { name: nameByAuth.get(pKey)?.name || null, minutes: 0, cost: 0, shifts: 0 };
    pp.minutes += minutes; pp.cost += cost; pp.shifts += 1;
    wByPerson.set(pKey, pp);
    const rKey = (r.role as string | null) || "unassigned";
    const rr = wByRole.get(rKey) || { minutes: 0, cost: 0, shifts: 0 };
    rr.minutes += minutes; rr.cost += cost; rr.shifts += 1;
    wByRole.set(rKey, rr);
  }

  // Current rates (open row per user, ordered by name).
  const seen = new Set<string>();
  const currentRates: Array<{
    user_id: string; name: string | null; role: string | null;
    hourly_rate_eur: number; effective_from: string;
  }> = [];
  for (const r of (ratesRes.data || []) as any[]) {
    if (r.effective_to && r.effective_to < today) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    currentRates.push({
      user_id: r.user_id, role: r.role || null,
      hourly_rate_eur: Number(r.hourly_rate_eur),
      effective_from: r.effective_from,
      name: nameByAuth.get(r.user_id)?.name || null,
    });
  }
  currentRates.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const houseName = houseNameForSlug(slug);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Labor · {houseName}</p>
          <h1 className="font-serif text-2xl">Clock-in log & labor cost</h1>
          <p className="mt-1 text-xs text-clay">Timezone {tz} · today {today}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/h/${slug}/clock`} className="rounded border border-black/15 px-3 py-1.5 text-xs">Open kiosk</Link>
        </div>
      </div>

      {/* Live floor */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">
          On the floor now — <span className="tabular-nums">{liveNow.length}</span>
        </h2>
        {liveNow.length ? (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {liveNow.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{s.name || s.email || s.user_id.slice(0, 8)}</div>
                  <div className="text-[11px] text-clay">{s.role || "—"}{s.station ? ` · ${s.station}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="tabular-nums">{elapsedLabel(Date.now() - Date.parse(s.clock_in!))}</div>
                  <div className="text-[11px] text-clay">since {new Date(s.clock_in!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-clay">No one clocked in.</p>
        )}
      </section>

      {/* Today's shift log */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Today's log</h2>
          <ExportButton rows={todaysRows} filename={`labor_${slug}_${today}.csv`} />
        </div>
        {todaysRows.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-clay">
                <tr>
                  <th className="py-1.5">Name</th>
                  <th>Role</th>
                  <th>In</th>
                  <th>Out</th>
                  <th className="text-right">Break</th>
                  <th className="text-right">Hours</th>
                  <th className="text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {todaysRows.map((r) => (
                  <tr key={r.id} className="border-t border-black/5">
                    <td className="py-1.5">{r.name || r.email || r.user_id.slice(0, 8)}</td>
                    <td>{r.role || "—"}</td>
                    <td className="tabular-nums">{r.clock_in ? new Date(r.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="tabular-nums">{r.clock_out ? new Date(r.clock_out).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="text-right tabular-nums">{r.break_minutes ? `${r.break_minutes}m` : "—"}</td>
                    <td className="text-right tabular-nums">{(r.paid_minutes / 60).toFixed(2)}</td>
                    <td className="text-right tabular-nums">{r.cost_eur == null ? "—" : eur(r.cost_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-clay">No shifts today.</p>
        )}
      </section>

      {/* Week aggregates */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">
          This week ({weekStart} → {today})
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded border border-black/10 p-3">
            <div className="text-xs text-clay">By person</div>
            {wByPerson.size ? (
              <ul className="mt-2 text-sm">
                {Array.from(wByPerson.entries())
                  .sort(([, a], [, b]) => b.cost - a.cost)
                  .map(([uid, x]) => (
                    <li key={uid} className="flex justify-between border-t border-black/5 py-1">
                      <span>{x.name || uid.slice(0, 8)}</span>
                      <span className="tabular-nums text-clay">{(x.minutes / 60).toFixed(1)}h · {eur(Math.round(x.cost * 100) / 100)}</span>
                    </li>
                  ))}
              </ul>
            ) : <p className="mt-2 text-sm text-clay">No hours yet.</p>}
          </div>
          <div className="rounded border border-black/10 p-3">
            <div className="text-xs text-clay">By role</div>
            {wByRole.size ? (
              <ul className="mt-2 text-sm">
                {Array.from(wByRole.entries())
                  .sort(([, a], [, b]) => b.cost - a.cost)
                  .map(([role, x]) => (
                    <li key={role} className="flex justify-between border-t border-black/5 py-1">
                      <span>{role}</span>
                      <span className="tabular-nums text-clay">{(x.minutes / 60).toFixed(1)}h · {eur(Math.round(x.cost * 100) / 100)}</span>
                    </li>
                  ))}
              </ul>
            ) : <p className="mt-2 text-sm text-clay">No hours yet.</p>}
          </div>
        </div>
        <p className="mt-3 text-xs text-clay">
          Week total: <span className="tabular-nums">{(weekMinutes / 60).toFixed(1)}h</span> · <span className="tabular-nums">{eur(Math.round(weekCost * 100) / 100)}</span>
        </p>
      </section>

      {/* Rates */}
      <RateManager
        entity_id={entity_id}
        initialRates={currentRates}
        roster={roster}
        canWrite={canWrite}
      />
    </main>
  );
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
