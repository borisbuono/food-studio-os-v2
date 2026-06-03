"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function dayLabel(d: Date) { return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
function iso(d: Date) { return d.toISOString().slice(0, 10); }
const hhmm = (t: string | null) => (t || "").slice(0, 5);

export default function Schedule() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<any[]>([]);
  const [clocks, setClocks] = useState<Record<string, "in" | "out">>({});
  const [today, setToday] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [zones, setZones] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const from = iso(days[0]), to = iso(days[6]);
      const prof = await getMyProfile();
      const ent = (prof && !prof.isAdmin ? prof.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null)) || "utopia";
      const rid = prof?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      const todayIso = new Date().toISOString().slice(0, 10);
      const dayStart = new Date(todayIso + "T00:00:00").toISOString();
      const [s, p, z, ce] = await Promise.all([
        supabase.from("shifts").select("id,profile_id,zone_id,shift_date,start_time,end_time").gte("shift_date", from).lte("shift_date", to),
        supabase.from("profiles").select("id,name,role"),
        supabase.from("zones").select("id,name,area").eq("restaurant_id", rid),
        supabase.from("clock_events").select("profile_id,event_type,event_at").gte("event_at", dayStart).order("event_at"),
      ]);
      if (!active) return;
      const venueZoneIds = new Set((z.data || []).map((r: any) => r.id));
      setShifts((s.data || []).filter((sh: any) => venueZoneIds.has(sh.zone_id)));
      setProfiles(Object.fromEntries((p.data || []).map((r: any) => [r.id, r])));
      setZones(Object.fromEntries((z.data || []).map((r: any) => [r.id, r])));
      // latest clock_event per profile = current in/out status
      const cmap: Record<string, "in" | "out"> = {};
      (ce.data || []).forEach((row: any) => { cmap[row.profile_id] = row.event_type; });
      setClocks(cmap);
      const todayList = (s.data || []).filter((sh: any) => sh.shift_date === todayIso && venueZoneIds.has(sh.zone_id));
      setToday(todayList);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (n: number) => { const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); setWeekStart(d); };
  const shiftsOn = (d: Date) => shifts.filter((s) => s.shift_date === iso(d)).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Schedule · weekly rota</p>
      {/* Today's roster — who's in, who's late */}
      {today.length ? (
        <section className="mt-4 rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">On today</p>
          <ul className="mt-2 divide-y divide-black/10">
            {today.map((sh: any) => {
              const prof = profiles[sh.profile_id];
              const status = clocks[sh.profile_id];
              const start = (sh.start_time || "").slice(0, 5);
              const lateBy = (() => {
                if (status === "in") return null;
                const [hh, mm] = start.split(":").map(Number);
                const startMin = (hh * 60) + (mm || 0);
                const now = new Date();
                const nowMin = now.getHours() * 60 + now.getMinutes();
                const diff = nowMin - startMin;
                return diff > 0 ? diff : null;
              })();
              return (
                <li key={sh.id} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="font-serif text-[15px] text-ink">{prof?.name || "Unassigned"}</span>
                  <span className="font-mono text-[11px]" style={{ color: status === "in" ? "#5A6B3B" : lateBy ? "#B8552E" : "#9C8B7A" }}>
                    {status === "in" ? "Clocked in" : lateBy ? "Late " + lateBy + "m" : "Due " + start}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <h1 className="mt-2 font-serif text-3xl text-ink">Who’s on, when</h1>

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => move(-1)} className="font-mono text-[12px] uppercase tracking-wide text-clay hover:text-ochre">‹ prev</button>
        <span className="font-mono text-[12px] text-ink">{dayLabel(days[0])} – {dayLabel(days[6])}</span>
        <button onClick={() => move(1)} className="font-mono text-[12px] uppercase tracking-wide text-clay hover:text-ochre">next ›</button>
      </div>

      {shifts.length === 0 && !loading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-black/20 p-5">
          <p className="font-sans text-[14px] text-ink-soft">No shifts scheduled this week — this is where the rota (FOH / BOH, by zone, by person) will live once shifts are added.</p>
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {days.map((d, i) => {
          const list = shiftsOn(d);
          return (
            <div key={i}>
              <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{dayLabel(d)}</p>
              {list.length ? (
                <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
                  {list.map((s) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="font-serif text-[16px] text-ink">{profiles[s.profile_id]?.name || "Unassigned"}</span>
                      <span className="font-mono text-[12px] text-ink-soft">{[zones[s.zone_id]?.area || zones[s.zone_id]?.name, hhmm(s.start_time) + "–" + hhmm(s.end_time)].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 border-t border-black/10 pt-2 font-sans text-[13px] text-clay">—</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
