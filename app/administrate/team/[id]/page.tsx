import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

function fmtDay(s: string) {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default async function PersonHub({ params }: { params: { id: string } }) {
  
  const supabase = supabaseServer();const { data: p } = await supabase.from("profiles").select("id,name,role,restaurant_id,email,color").eq("id", params.id).maybeSingle();
  if (!p) redirect("/administrate/team");

  const { data: venue } = await supabase.from("restaurants").select("name").eq("id", p.restaurant_id).maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const shifts = (await supabase.from("shifts")
    .select("shift_date,start_time,end_time,zone_id")
    .eq("profile_id", p.id)
    .gte("shift_date", today)
    .order("shift_date").limit(5)).data || [];
  const zoneIds = [...new Set(shifts.map((s: any) => s.zone_id).filter(Boolean))];
  const zones = zoneIds.length ? ((await supabase.from("zones").select("id,name,area").in("id", zoneIds)).data || []) : [];
  const zname = new Map(zones.map((z: any) => [z.id, { name: z.name, area: z.area }]));

  // recent clock events
  const clock = (await supabase.from("clock_events")
    .select("event_type,event_at")
    .eq("profile_id", p.id)
    .order("event_at", { ascending: false }).limit(1)).data || [];
  const lastClock = clock[0];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">← team</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: p.color || "var(--accent)" }}>Person · {p.role || "team"}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{noEmoji(p.name)}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">{[venue?.name, p.email].filter(Boolean).join(" · ")}</p>

      {/* Status — react-to */}
      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-5">
        <p className="font-sans text-xs font-medium text-clay">Now</p>
        <p className="mt-1 font-serif text-xl text-ink">
          {lastClock ? `${lastClock.event_type === "in" ? "Clocked in" : "Off the clock"} · ${new Date(lastClock.event_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "No clock events yet"}
        </p>
      </div>

      {/* Next shifts */}
      <section className="mt-8">
        <h2 className="font-serif text-xl text-ink">Next shifts</h2>
        {!shifts.length ? (
          <p className="mt-2 font-sans text-[14px] text-clay">Nothing scheduled. <Link href="/schedule" className="text-ember">Open the rota →</Link></p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shifts.map((s: any, i: number) => {
              const z = zname.get(s.zone_id);
              return (
                <li key={i} className="flex items-baseline justify-between gap-4 rounded-xl border border-black/10 bg-card px-4 py-3">
                  <div>
                    <p className="font-sans text-[14px] text-ink">{fmtDay(s.shift_date)}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{[z?.area, z?.name].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <span className="font-mono text-[12px] text-ink">{(s.start_time || "").slice(0, 5)} – {(s.end_time || "").slice(0, 5)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Person atom action set */}
      <div className="mt-8 grid grid-cols-2 gap-3">
        <Link href={"/messages?to=" + p.id} className="rounded-xl bg-ochre px-4 py-3 text-center font-sans text-[14px] font-medium text-[#F7F7F4]">Message</Link>
        <Link href="/schedule" className="rounded-xl border border-black/10 bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Schedule</Link>
        <Link href="/academy" className="rounded-xl border border-black/10 bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Skill ladder</Link>
        <Link href="/clock" className="rounded-xl border border-black/10 bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Clock</Link>
      </div>
    </main>
  );
}
