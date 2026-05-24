import Home, { EntityStats } from "@/components/Home";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BM = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
const TALLER = "ca83e06f-a24d-43d7-bce4-57ac341d190f";

export default async function Page() {
  const restaurants = (await supabase.from("restaurants").select("id,name")).data || [];
  const rname = new Map(restaurants.map((r: any) => [r.id, r.name]));
  const eod = (await supabase.from("eod_reports").select("restaurant_id,report_date,revenue,actual_covers").order("report_date", { ascending: false })).data || [];
  const zones = (await supabase.from("zones").select("id,restaurant_id")).data || [];
  const mep = (await supabase.from("mep_dishes").select("zone_id").eq("is_active", true)).data || [];
  const tasks = (await supabase.from("tasks").select("zone_id,frequency_rule").eq("is_active", true).eq("task_type", "cleaning")).data || [];
  const inbox = (await supabase.from("inbox_items").select("restaurant_id")).data || [];
  const events = (await supabase.from("sales_events").select("restaurant_id")).data || [];

  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

  const venueStats = (vid: string): EntityStats => {
    const rs = eod.filter((e: any) => e.restaurant_id === vid);
    const L = rs[0], P = rs[1];
    const rev = L ? Number(L.revenue || 0) : 0;
    const cov = L ? Number(L.actual_covers || 0) : 0;
    const avg = cov ? rev / cov : 0;
    const pRev = P ? Number(P.revenue || 0) : 0;
    const pCov = P ? Number(P.actual_covers || 0) : 0;
    const pAvg = pCov ? pRev / pCov : 0;
    const zoneIds = zones.filter((z: any) => z.restaurant_id === vid).map((z: any) => z.id);
    const prep = mep.filter((m: any) => zoneIds.includes(m.zone_id)).length;
    const cleaningDue = tasks.filter((t: any) => zoneIds.includes(t.zone_id) && ((t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday)).length;
    return {
      label: rname.get(vid) || "Venue",
      reportPeriod: L?.report_date ?? null,
      rev, cov, avg: Math.round(avg),
      revDelta: pRev ? Math.round((rev / pRev - 1) * 100) : null,
      avgDelta: pAvg ? Math.round((avg / pAvg - 1) * 100) : null,
      inbox: inbox.filter((i: any) => i.restaurant_id === vid).length,
      events: events.filter((e: any) => e.restaurant_id === vid).length,
      prep, cleaningDue,
    };
  };

  const bm = venueStats(BM);
  const taller = venueStats(TALLER);
  const hRev = bm.rev + taller.rev, hCov = bm.cov + taller.cov;
  const holdings: EntityStats = {
    label: "Holdings",
    reportPeriod: null,
    rev: hRev, cov: hCov, avg: hCov ? Math.round(hRev / hCov) : 0,
    revDelta: null, avgDelta: null,
    inbox: bm.inbox + taller.inbox,
    events: bm.events + taller.events,
    prep: bm.prep + taller.prep,
    cleaningDue: bm.cleaningDue + taller.cleaningDue,
    venues: [{ name: bm.label, rev: bm.rev, cov: bm.cov }, { name: taller.label, rev: taller.rev, cov: taller.cov }],
  };

  return <Home statsByEntity={{ holdings, bistro_mondo: bm, taller }} />;
}
