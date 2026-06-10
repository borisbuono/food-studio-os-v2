import Home, { EntityStats } from "@/components/Home";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { getFrestoAdapter } from "@/lib/integrations/fresto";

export const dynamic = "force-dynamic";

const BM = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
const TALLER = "ca83e06f-a24d-43d7-bce4-57ac341d190f";
const UT = "a0000000-0000-4000-8000-000000000001";

export default async function Page() {
  
  const supabase = supabaseServer();const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  // --- period boundaries for the Office dashboard shuffler (week / last week / month / YTD) ---
  const _now = new Date();
  const _mon = new Date(Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate()));
  _mon.setUTCDate(_mon.getUTCDate() - ((_now.getUTCDay() + 6) % 7));
  const monStr = _mon.toISOString().slice(0, 10);
  const _lastMon = new Date(_mon); _lastMon.setUTCDate(_lastMon.getUTCDate() - 7);
  const lastMonStr = _lastMon.toISOString().slice(0, 10);
  const monthStr = today.slice(0, 8) + "01";
  const ytdStr = today.slice(0, 4) + "-01-01";
  const aggPeriod = (rows: any[]) => {
    const rev = rows.reduce((a: number, r: any) => a + Number(r.revenue || 0), 0);
    const cov = rows.reduce((a: number, r: any) => a + Number(r.actual_covers || 0), 0);
    return { rev, cov, avg: cov ? Math.round(rev / cov) : 0, n: rows.length };
  };

  const restaurants = (await supabase.from("restaurants").select("id,name")).data || [];
  const rname = new Map(restaurants.map((r: any) => [r.id, r.name]));
  const eod = (await supabase.from("eod_reports").select("restaurant_id,report_date,revenue,actual_covers").order("report_date", { ascending: false })).data || [];
  const zones = (await supabase.from("zones").select("id,restaurant_id")).data || [];
  const mep = (await supabase.from("mep_dishes").select("zone_id").eq("is_active", true)).data || [];
  const tasks = (await supabase.from("tasks").select("zone_id,frequency_rule").eq("is_active", true).eq("task_type", "cleaning")).data || [];
  const inbox = (await supabase.from("inbox_items").select("restaurant_id,status")).data || [];
  const events = (await supabase.from("sales_events").select("restaurant_id,event_date,title,guests_count")).data || [];
  const menuAll = (await supabase.from("menu_items").select("restaurant_id,name,is_special,is_eighty_six,is_active,price,cost,units_sold")).data || [];
  const orders = (await supabase.from("orders").select("restaurant_id,delivery_date,status,provider_id")).data || [];
  const providers = (await supabase.from("providers").select("id,name")).data || [];
  const pname = new Map(providers.map((p: any) => [p.id, p.name]));

  // --- today's roster (shifts + clock state) mirrored onto the Office home (Day 7) ---
  const shiftsToday = (await supabase.from("shifts").select("id,profile_id,zone_id,shift_date,start_time,end_time").eq("shift_date", today)).data || [];
  const rosterProfiles = shiftsToday.length ? (await supabase.from("profiles").select("id,name")).data || [] : [];
  const clockToday = shiftsToday.length ? (await supabase.from("clock_events").select("profile_id,event_type,event_at").gte("event_at", today + "T00:00:00Z").order("event_at")).data || [] : [];
  const profName = new Map(rosterProfiles.map((p: any) => [p.id, p.name]));
  const clockState = new Map<string, string>();
  clockToday.forEach((e: any) => clockState.set(e.profile_id, e.event_type));
  // Madrid wall-clock for the late calculation (the server runs UTC)
  const _mad = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const nowMin = Number(_mad.slice(0, 2)) * 60 + Number(_mad.slice(3, 5));

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
    const specials = menuAll.filter((m: any) => m.restaurant_id === vid && m.is_special && m.is_active !== false).map((m: any) => noEmoji(m.name)).slice(0, 4);
    const eightySix = menuAll.filter((m: any) => m.restaurant_id === vid && m.is_eighty_six).map((m: any) => noEmoji(m.name)).slice(0, 4);
    const dueOrders = orders.filter((o: any) => o.restaurant_id === vid && (o.delivery_date === today || o.delivery_date === tomorrow) && !["delivered", "cancelled"].includes(o.status || ""));
    const eventsToday = events.filter((e: any) => e.restaurant_id === vid && e.event_date === today).map((e: any) => ({ title: noEmoji(e.title || "Event"), guests: Number(e.guests_count || 0) }));
    const messages = inbox.filter((i: any) => i.restaurant_id === vid && (i.status === "open" || i.status === "new" || i.status == null)).length;
    const roster = shiftsToday
      .filter((sh: any) => zoneIds.includes(sh.zone_id))
      .sort((a: any, b: any) => (a.start_time || "").localeCompare(b.start_time || ""))
      .map((sh: any) => {
        const start = (sh.start_time || "").slice(0, 5);
        const startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5) || "0");
        const status: "in" | "late" | "due" = clockState.get(sh.profile_id) === "in" ? "in" : nowMin > startMin ? "late" : "due";
        return { name: (profName.get(sh.profile_id) as string) || "Unassigned", start, status, lateBy: status === "late" ? nowMin - startMin : undefined };
      });
    const periods = {
      week: aggPeriod(rs.filter((e: any) => e.report_date >= monStr)),
      lastWeek: aggPeriod(rs.filter((e: any) => e.report_date >= lastMonStr && e.report_date < monStr)),
      month: aggPeriod(rs.filter((e: any) => e.report_date >= monthStr)),
      ytd: aggPeriod(rs.filter((e: any) => e.report_date >= ytdStr)),
    };
    return {
      periods,
      label: rname.get(vid) || "Venue",
      reportPeriod: L?.report_date ?? null,
      rev, cov, avg: Math.round(avg),
      revDelta: pRev ? Math.round((rev / pRev - 1) * 100) : null,
      avgDelta: pAvg ? Math.round((avg / pAvg - 1) * 100) : null,
      inbox: inbox.filter((i: any) => i.restaurant_id === vid).length,
      events: events.filter((e: any) => e.restaurant_id === vid).length,
      prep, cleaningDue,
      specials, eightySix,
      deliveriesDue: dueOrders.length,
      deliveriesNext: dueOrders.length ? (pname.get(dueOrders[0].provider_id) ? noEmoji(pname.get(dueOrders[0].provider_id)) : null) : null,
      eventsToday, messages, roster,
    };
  };

  const bm = venueStats(BM);
  const taller = venueStats(TALLER);
  // --- tonight's live service pulse via the fresto adapter (mock until connected) ---
  const venuePulse = async (vid: string) => {
    try {
      const f = await getFrestoAdapter(vid);
      const [sum, bk] = await Promise.all([f.getSalesSummary(today), f.getBookings(today)]);
      const booked = bk.filter((b: any) => b.status !== "cancelled" && b.status !== "no_show").length;
      return { mode: f.mode, bookedTonight: booked, openTabs: sum.openTabs, liveGross: Math.round(sum.grossSales), covers: sum.covers };
    } catch { return undefined; }
  };
  const [bmPulse, tallerPulse, utPulse] = await Promise.all([venuePulse(BM), venuePulse(TALLER), venuePulse(UT)]);
  (bm as any).pulse = bmPulse;
  (taller as any).pulse = tallerPulse;
  const rollPulse = (a: any, b: any) => (a || b) ? {
    mode: ((a?.mode === "live" && b?.mode === "live") ? "live" : "mock") as "live" | "mock",
    bookedTonight: (a?.bookedTonight || 0) + (b?.bookedTonight || 0),
    openTabs: (a?.openTabs || 0) + (b?.openTabs || 0),
    liveGross: (a?.liveGross || 0) + (b?.liveGross || 0),
    covers: (a?.covers || 0) + (b?.covers || 0),
  } : undefined;

  const hRev = bm.rev + taller.rev, hCov = bm.cov + taller.cov;
  const addP = (a: any, b: any) => { const rev = a.rev + b.rev, cov = a.cov + b.cov; return { rev, cov, avg: cov ? Math.round(rev / cov) : 0, n: a.n + b.n }; };
  const holdings: EntityStats = {
    label: "Holdings",
    reportPeriod: null,
    periods: bm.periods && taller.periods ? {
      week: addP(bm.periods.week, taller.periods.week),
      lastWeek: addP(bm.periods.lastWeek, taller.periods.lastWeek),
      month: addP(bm.periods.month, taller.periods.month),
      ytd: addP(bm.periods.ytd, taller.periods.ytd),
    } : undefined,
    rev: hRev, cov: hCov, avg: hCov ? Math.round(hRev / hCov) : 0,
    revDelta: null, avgDelta: null,
    inbox: bm.inbox + taller.inbox,
    events: bm.events + taller.events,
    prep: bm.prep + taller.prep,
    cleaningDue: bm.cleaningDue + taller.cleaningDue,
    venues: [{ name: bm.label, rev: bm.rev, cov: bm.cov }, { name: taller.label, rev: taller.rev, cov: taller.cov }],
    specials: [...(bm.specials || []), ...(taller.specials || [])].slice(0, 4),
    eightySix: [...(bm.eightySix || []), ...(taller.eightySix || [])].slice(0, 4),
    deliveriesDue: (bm.deliveriesDue || 0) + (taller.deliveriesDue || 0),
    deliveriesNext: bm.deliveriesNext || taller.deliveriesNext || null,
    eventsToday: [...(bm.eventsToday || []), ...(taller.eventsToday || [])],
    messages: (bm.messages || 0) + (taller.messages || 0),
    roster: [
      ...(bm.roster || []).map((r) => ({ ...r, venue: bm.label })),
      ...(taller.roster || []).map((r) => ({ ...r, venue: taller.label })),
    ],
    pulse: rollPulse(bmPulse, tallerPulse),
  };

  const utMenu = menuAll.filter((m: any) => m.restaurant_id === UT);
  const utInv = (await supabase.from("inventory_items").select("unit_cost,quantity_on_hand,counted_qty").eq("restaurant_id", UT)).data || [];
  const utContribution = utMenu.reduce((a: number, m: any) => a + (Number(m.price || 0) - Number(m.cost || 0)) * Number(m.units_sold || 0), 0);
  const utLoss = utInv.reduce((a: number, i: any) => { if (i.counted_qty == null) return a; const v = (Number(i.quantity_on_hand || 0) - Number(i.counted_qty || 0)) * Number(i.unit_cost || 0); return a + (v > 0 ? v : 0); }, 0);
  const utBase = venueStats(UT);
  const utopia: EntityStats = {
    ...utBase,
    label: "Restaurant Utopia", reportPeriod: null,
    rev: 0, cov: 0, avg: 0, revDelta: null, avgDelta: null,
    trial: true, dishCount: utMenu.length, contribution: Math.round(utContribution), varianceLoss: Math.round(utLoss * 100) / 100,
    pulse: utPulse,
  };

  return <Home statsByEntity={{ holdings, bistro_mondo: bm, taller, utopia }} />;
}
