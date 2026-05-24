import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DAILY = ["daily_open", "daily_pre_service", "daily_close"];
const WEEKLY = ["weekly_monday", "weekly_tuesday", "weekly_wednesday", "weekly_thursday", "weekly_friday", "weekly_saturday", "weekly_sunday"];
const FL: Record<string, string> = { daily_open: "Opening", daily_pre_service: "Pre-service", daily_close: "Closing", weekly_monday: "Monday", weekly_tuesday: "Tuesday", weekly_wednesday: "Wednesday", weekly_thursday: "Thursday", weekly_friday: "Friday", weekly_saturday: "Saturday", weekly_sunday: "Sunday" };

export default async function Cleaning() {
  const zones: any[] = (await supabase.from("zones").select("id,name,area,restaurant_id,sort_order").order("sort_order")).data || [];
  const tasks: any[] = (await supabase.from("tasks").select("id,zone_id,name,sub_text,frequency_rule,sort_order").eq("task_type", "cleaning").eq("is_active", true).order("sort_order")).data || [];
  const rests: any[] = (await supabase.from("restaurants").select("id,name")).data || [];
  const tByZone = (zid: string) => tasks.filter((t: any) => t.zone_id === zid);
  const Line = ({ t }: { t: any }) => (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="font-sans text-[15px] text-ink">{t.name}</span>
      <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{FL[t.frequency_rule] || ""}</span>
    </li>
  );
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Cleaning · live schedule</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{tasks.length} cleaning tasks</h1>
      {rests.map((r: any) => {
        const rz = zones.filter((z: any) => z.restaurant_id === r.id && tByZone(z.id).length);
        if (!rz.length) return null;
        return (
          <div key={r.id} className="mt-10">
            <h2 className="font-serif text-2xl text-ink">{r.name}</h2>
            {rz.map((z: any) => {
              const zt = tByZone(z.id);
              const daily = zt.filter((t: any) => DAILY.includes(t.frequency_rule));
              const weekly = zt.filter((t: any) => WEEKLY.includes(t.frequency_rule));
              return (
                <section key={z.id} className="mt-6">
                  <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{z.name}</h3>
                  {daily.length ? <div className="mt-2"><p className="font-serif italic text-[15px] text-ink-soft">Daily</p><ul className="mt-1 divide-y divide-black/10">{daily.map((t: any) => <Line key={t.id} t={t} />)}</ul></div> : null}
                  {weekly.length ? <div className="mt-3"><p className="font-serif italic text-[15px] text-ink-soft">Weekly</p><ul className="mt-1 divide-y divide-black/10">{weekly.map((t: any) => <Line key={t.id} t={t} />)}</ul></div> : null}
                </section>
              );
            })}
          </div>
        );
      })}
    </main>
  );
}
