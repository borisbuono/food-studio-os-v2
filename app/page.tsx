import Home, { HomeStats } from "@/components/Home";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BM = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";

export default async function Page() {
  const eod = (await supabase.from("eod_reports").select("report_date,revenue,actual_covers").eq("restaurant_id", BM).order("report_date", { ascending: false }).limit(2)).data || [];
  const L = eod[0], P = eod[1];
  const rev = L ? Number(L.revenue || 0) : 0;
  const cov = L ? Number(L.actual_covers || 0) : 0;
  const avg = cov ? rev / cov : 0;
  const pRev = P ? Number(P.revenue || 0) : 0;
  const pCov = P ? Number(P.actual_covers || 0) : 0;
  const pAvg = pCov ? pRev / pCov : 0;
  const revDelta = pRev ? Math.round((rev / pRev - 1) * 100) : null;
  const avgDelta = pAvg ? Math.round((avg / pAvg - 1) * 100) : null;

  const inbox = (await supabase.from("inbox_items").select("*", { count: "exact", head: true })).count ?? 0;
  const events = (await supabase.from("sales_events").select("*", { count: "exact", head: true })).count ?? 0;

  const zones = (await supabase.from("zones").select("id").eq("restaurant_id", BM)).data || [];
  const zoneIds = zones.map((z: any) => z.id);
  const prep = zoneIds.length ? ((await supabase.from("mep_dishes").select("*", { count: "exact", head: true }).eq("is_active", true).in("zone_id", zoneIds)).count ?? 0) : 0;
  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const tasks = zoneIds.length ? ((await supabase.from("tasks").select("frequency_rule").eq("is_active", true).eq("task_type", "cleaning").in("zone_id", zoneIds)).data || []) : [];
  const cleaningDue = tasks.filter((t: any) => (t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday).length;

  const stats: HomeStats = { reportPeriod: L?.report_date ?? null, rev, cov, avg: Math.round(avg), revDelta, avgDelta, inbox, events, prep, cleaningDue };
  return <Home stats={stats} />;
}
