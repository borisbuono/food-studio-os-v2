import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

const BISTRO_MONDO = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";

export default async function Today() {
  const venue = (await supabase.from("restaurants").select("id,name").eq("id", BISTRO_MONDO).maybeSingle()).data;
  const zones = (await supabase.from("zones").select("id").eq("restaurant_id", BISTRO_MONDO)).data || [];
  const zoneIds = zones.map((z: any) => z.id);

  const preps = zoneIds.length
    ? (await supabase.from("mep_dishes").select("name,sort_order").eq("is_active", true).in("zone_id", zoneIds).order("sort_order").limit(5)).data || []
    : [];

  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const tasks = zoneIds.length
    ? (await supabase.from("tasks").select("frequency_rule,zone_id").eq("is_active", true).eq("task_type", "cleaning").in("zone_id", zoneIds)).data || []
    : [];
  const dueToday = tasks.filter((t: any) => (t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday).length;

  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Today · {venue?.name}</p>
      <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">{dateLabel}</h1>

      <div className="mt-8 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium text-ember">Covers today</p>
        <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink-soft">No covers loaded yet — bookings aren’t connected. This is where the day’s guests and special diets will land.</p>
      </div>

      <div className="mt-4 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium text-ember">Priority prep</p>
        {preps.length ? (
          <ol className="mt-3 space-y-2">
            {preps.map((p: any, i: number) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="font-mono text-[12px] text-clay">{i + 1}</span>
                <span className="font-serif text-[19px] text-ink">{noEmoji(p.name)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 font-sans text-[14px] text-clay">No prep dishes loaded for this venue.</p>
        )}
        <Link href="/execute/prep" className="mt-4 inline-block font-sans text-sm text-ember">All prep →</Link>
      </div>

      <Link href="/execute/cleaning" className="mt-4 block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
        <p className="font-sans text-xs font-medium text-ember">Cleaning due today</p>
        <h2 className="mt-1 font-serif text-3xl text-ink">{dueToday} <span className="font-sans text-base text-ink-soft">tasks</span></h2>
        <p className="mt-2 font-sans text-[14px] text-ink-soft">Daily close + pre-service, plus today’s weekly tasks.</p>
      </Link>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Venue + role switching arrives with sign-in</p>
    </main>
  );
}
