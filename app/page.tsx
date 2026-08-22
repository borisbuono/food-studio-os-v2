import HomeSwitch from "@/components/HomeSwitch";
import type { CompassData, LoopStep, CompassAlert } from "@/components/HomeCompass";
import { supabaseServer } from "@/lib/supabaseServer";
import { EntityKey, ENTITY_LABEL } from "@/lib/entities";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const BM = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
const TALLER = "ca83e06f-a24d-43d7-bce4-57ac341d190f";
// Utopia (a0000000-…-0001) intentionally dropped — trial archived 2026-08-22.

// Entity code used by the finance tables (invoice_inbox / bank_movements share BM / IFL / BBH).
const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL" };

// Assumed service window per venue -- used to compute the service step state
// and the "service in Xh" copy. These match the current operating hours; if a
// venue reshapes, edit here (Boris: this could later come from a venue settings row).
const SERVICE_HOURS: Record<EntityKey, { open: string; close: string }> = {
  bistro_mondo: { open: "19:00", close: "23:30" },
  taller: { open: "19:00", close: "23:30" },
  holdings: { open: "19:00", close: "23:30" }, // synthetic (holdings is not a venue but keep the shape)
};

// Madrid wall-clock helper -- server runs UTC.
function madridClock() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  const hhmm = `${hh}:${mm}`;
  const minutes = Number(hh) * 60 + Number(mm);
  return { hhmm, minutes };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function dateLabelMadrid() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
}

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstOfMonth(iso: string): string { return iso.slice(0, 7) + "-01"; }
function priorMonthFirst(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1); d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function Page() {
  const _authSb = supabaseServer();
  const { data: { user: _anonCheck } } = await _authSb.auth.getUser();
  if (!_anonCheck) redirect("/welcome");

  const supabase = supabaseServer();
  const today = madridToday();
  const in30 = addDaysIso(today, 30);
  const monthStart = firstOfMonth(today);
  const priorStart = priorMonthFirst(today);
  const now = madridClock();
  const dateLabel = dateLabelMadrid();

  // -----------------------------------------------------------------------
  // Batch pull the tables we need for every venue in one call each. Cheap.
  //
  // 2026-08-07 wire fix -- previously this file queried eod_accounting (which
  // is empty) instead of eod_pos (439 real BM rows + 94 real IFL rows), and
  // bookings only for today (missing Anna 27-Aug + Fincadelica 11-19 Aug).
  // Now we pull the tables Boris actually populated.
  // -----------------------------------------------------------------------
  const [
    // OS state -- the loop still uses eod_accounting for today's manual EOD
    // (a different journal from the POS import), but the numbers on Home
    // read from eod_pos (real POS import).
    eodTodayRes,
    eodPosRecentRes,           // last 14 days of POS data across both venues -- source of "yesterday's gross"
    bookingsTodayRes,          // today's covers for the loop
    bookings30dRes,            // future 30d bookings -- source of "on the book"
    revenueMonthRes,           // month rollups for delta-vs-prior
    weatherRes,                // last 7 days of Ibiza weather -- take today or most-recent
    financeSnapshotsRes,       // latest weekly snapshot per entity -- cash position
    albaranesTodayRes,
    mepActiveRes,
    zonesRes,
    chefConvRes,
    invoiceInboxRes,
    bankMovementsRes,
    platformBillingRes,
    financeAnomaliesRes,
    bankMatchesOpenRes,
    masterTodosRes,
    filesInboxRes,
  ] = await Promise.all([
    supabase.from("eod_accounting").select("restaurant_id,revenue,actual_covers").eq("report_date", today),
    supabase.from("eod_pos").select("restaurant_id,date,covers,total_gross_eur,food_net_eur,wine_net_eur,tips_eur").gte("date", addDaysIso(today, -14)).lte("date", today).order("date", { ascending: false }),
    supabase.from("bookings").select("restaurant_id,party_size,status,service_date,service_time,guest_name").eq("service_date", today),
    supabase.from("bookings").select("restaurant_id,party_size,status,service_date,service_time,guest_name").gte("service_date", today).lte("service_date", in30).order("service_date", { ascending: true }),
    supabase.from("revenue_monthly_history").select("restaurant_id,month,revenue_gross_eur,covers").gte("month", priorStart).lte("month", monthStart),
    supabase.from("weather_daily").select("date,temp_max_c,precipitation_mm,rain_mm,label").gte("date", addDaysIso(today, -7)).lte("date", today).order("date", { ascending: false }),
    supabase.from("finance_weekly_snapshots").select("entity_code,week_ending,revenue_gross_eur,cash_position_eur,ap_pendiente_eur,ap_over_90d_eur,food_cost_pct,prime_cost_pct").order("week_ending", { ascending: false }).limit(30),
    supabase.from("albarans").select("restaurant_id,received_at").gte("received_at", today + "T00:00:00").lt("received_at", today + "T23:59:59"),
    supabase.from("mep_dishes").select("zone_id,is_active,updated_at").eq("is_active", true),
    supabase.from("zones").select("id,restaurant_id"),
    supabase.from("assistant_conversations").select("user_id,created_at").gte("created_at", today + "T07:00:00").lt("created_at", today + "T11:00:00"),
    supabase.from("invoice_inbox").select("id,entity_id,amount_eur,supplier_name,arrived_at").gt("amount_eur", 500).not("match_status", "in", "(approved,rejected,duplicate)"),
    supabase.from("bank_movements").select("id,entity_id,amount_eur,description,movement_date,reconciled_to").eq("reconciled_to", "unmatched"),
    supabase.from("platform_billing_status").select("entity_code,platform,state,notes,failure_count_30d,last_failure_at").in("state", ["failing", "disabled"]),
    supabase.from("v_finance_anomalies_open").select("id,entity_code,kind,severity,description").gte("severity", 3),
    supabase.from("v_bank_matches_open").select("movement_id,entity_code,top_confidence").not("top_candidate_id", "is", null),
    supabase.from("master_todos").select("id,title,impact_score,entity_code,due_at").not("status", "in", "(completed,deferred)").order("impact_score", { ascending: false }).limit(30),
    supabase.from("files_inbox").select("suggested_entity,status").eq("status", "needs_triage").limit(500),
  ]);

  // Some of the newer tables may not exist yet in every environment; treat null as empty.
  const eodRows: any[] = eodTodayRes.data || [];
  const eodPosRows: any[] = eodPosRecentRes.data || [];
  const bookingsToday: any[] = bookingsTodayRes.data || [];
  const bookings30d: any[] = bookings30dRes.data || [];
  const revMonthRows: any[] = revenueMonthRes.data || [];
  const weatherRows: any[] = weatherRes.data || [];
  const financeSnaps: any[] = financeSnapshotsRes.data || [];
  const albaranes: any[] = albaranesTodayRes.data || [];
  const mep: any[] = mepActiveRes.data || [];
  const zones: any[] = zonesRes.data || [];
  const chefConv: any[] = chefConvRes.data || [];
  const invoiceInbox: any[] = invoiceInboxRes.data || [];
  const bankUnmatched: any[] = bankMovementsRes.data || [];
  const platformBilling: any[] = platformBillingRes.data || [];
  const financeAnomalies: any[] = financeAnomaliesRes.data || [];
  const bankProposed: any[] = bankMatchesOpenRes.data || [];
  const masterTodos: any[] = masterTodosRes.data || [];
  const filesInboxRows: any[] = filesInboxRes.data || [];

  // Age > 7 days on bank movements
  const sevenDaysAgo = addDaysIso(today, -7);
  const bankOld = bankUnmatched.filter((r) => (r.movement_date || "") <= sevenDaysAgo);

  const zonesByRestaurant = new Map<string, string[]>();
  for (const z of zones) {
    const arr = zonesByRestaurant.get(z.restaurant_id) || [];
    arr.push(z.id);
    zonesByRestaurant.set(z.restaurant_id, arr);
  }

  // Latest weather row (today, or most-recent within 7d fallback).
  const weatherLatest = weatherRows[0] || null;

  // -----------------------------------------------------------------------
  // Compute compass state for a single restaurant / entity.
  // -----------------------------------------------------------------------
  function compassFor(rid: string, entity: EntityKey) {
    const eod = eodRows.find((e) => e.restaurant_id === rid);
    const coversToday = bookingsToday
      .filter((b) => b.restaurant_id === rid && !["cancelled", "no_show"].includes((b.status || "").toLowerCase()))
      .reduce((a, b) => a + Number(b.party_size || 0), 0);

    // Future 30d bookings (excluding today already counted above)
    const future = bookings30d
      .filter((b) => b.restaurant_id === rid && !["cancelled", "no_show"].includes((b.status || "").toLowerCase()));
    const futureCovers = future.reduce((a, b) => a + Number(b.party_size || 0), 0);
    const nextBooking = future
      .filter((b) => b.service_date > today)
      .sort((a, b) => (a.service_date + (a.service_time || "")).localeCompare(b.service_date + (b.service_time || "")))[0] || null;

    // Yesterday's POS (real POS import -- lags a day or two; take max(date) for restaurant).
    const posForRid = eodPosRows.filter((r) => r.restaurant_id === rid);
    const yestPos = posForRid[0] || null;
    const yesterday = yestPos ? {
      date: String(yestPos.date),
      grossEur: Number(yestPos.total_gross_eur || 0),
      covers: Number(yestPos.covers || 0),
      avgSpendEur: Number(yestPos.covers || 0) > 0 ? Number(yestPos.total_gross_eur || 0) / Number(yestPos.covers) : 0,
    } : null;

    // Month-vs-prior from revenue_monthly_history (holded rollup, ex-VAT).
    const thisMonth = revMonthRows.find((r) => r.restaurant_id === rid && String(r.month).startsWith(monthStart.slice(0, 7)));
    const priorMonth = revMonthRows.find((r) => r.restaurant_id === rid && String(r.month).startsWith(priorStart.slice(0, 7)));
    const month = thisMonth ? {
      thisGrossEur: Number(thisMonth.revenue_gross_eur || 0),
      priorGrossEur: priorMonth ? Number(priorMonth.revenue_gross_eur || 0) : null,
      deltaPct: priorMonth && Number(priorMonth.revenue_gross_eur || 0) > 0
        ? ((Number(thisMonth.revenue_gross_eur || 0) - Number(priorMonth.revenue_gross_eur || 0)) / Number(priorMonth.revenue_gross_eur)) * 100
        : null,
    } : null;

    // Weather -- shared across venues (single lat/lon for Ibiza).
    const weather = weatherLatest ? {
      date: String(weatherLatest.date),
      tempMaxC: weatherLatest.temp_max_c != null ? Number(weatherLatest.temp_max_c) : null,
      label: weatherLatest.label || null,
      rainMm: weatherLatest.rain_mm != null ? Number(weatherLatest.rain_mm) : (weatherLatest.precipitation_mm != null ? Number(weatherLatest.precipitation_mm) : null),
    } : null;

    // Latest cash position from finance_weekly_snapshots.
    const snap = financeSnaps.find((s) => s.entity_code === ENTITY_CODE[entity]) || null;
    const cashPosition = snap ? {
      latestEur: snap.cash_position_eur != null ? Number(snap.cash_position_eur) : null,
      weekEnding: String(snap.week_ending || ""),
      apPendienteEur: snap.ap_pendiente_eur != null ? Number(snap.ap_pendiente_eur) : null,
    } : null;

    const albarans = albaranes.filter((a) => a.restaurant_id === rid);
    const zIds = zonesByRestaurant.get(rid) || [];
    const openPrep = mep.filter((m) => zIds.includes(m.zone_id)).length;

    const svc = SERVICE_HOURS[entity];
    const openMin = toMinutes(svc.open);
    const closeMin = toMinutes(svc.close);
    let servicePhase: "before" | "during" | "after" | "unknown" = "unknown";
    let minutesToService: number | null = null;
    if (now.minutes < openMin) { servicePhase = "before"; minutesToService = openMin - now.minutes; }
    else if (now.minutes < closeMin) { servicePhase = "during"; minutesToService = 0; }
    else { servicePhase = "after"; minutesToService = null; }

    // Morning-brief signal: any assistant_conversations turn today 07-11 (user-agnostic; a real
    // brief involves the operator opening the OS + typing to Chef).
    const morningDone = chefConv.length > 0;

    const loop: LoopStep[] = [
      {
        key: "morning",
        label: "Morning brief",
        detail: morningDone ? "chef conversation logged" : "kick off the day with Chef",
        status: morningDone ? "done" : now.minutes < 11 * 60 ? "in_progress" : "upcoming",
        timeLabel: morningDone ? "done · 09:00" : "target 09:00",
        href: "/administrate/chef-log",
      },
      {
        key: "deliveries",
        label: "Deliveries received",
        detail: albarans.length
          ? `${albarans.length} albarán${albarans.length === 1 ? "" : "s"} today`
          : "no deliveries logged yet",
        status: albarans.length ? "done"
          : now.minutes >= 11 * 60 ? "upcoming"
          : now.minutes >= 8 * 60 ? "in_progress"
          : "upcoming",
        timeLabel: albarans.length ? undefined : "target 08–11",
        href: "/execute/receiving",
      },
      {
        key: "prep",
        label: "Prep",
        detail: openPrep
          ? `${openPrep} dish${openPrep === 1 ? "" : "es"} on the list`
          : "prep list empty",
        status: openPrep > 0 && servicePhase === "before" ? "in_progress"
          : openPrep === 0 && servicePhase !== "before" ? "done"
          : servicePhase === "before" ? "upcoming"
          : servicePhase === "during" ? "in_progress"
          : "done",
        href: "/execute/pass",
      },
      {
        key: "service",
        label: "Service",
        detail: servicePhase === "during"
          ? "on the pass now"
          : servicePhase === "after"
          ? "closed"
          : coversToday > 0
          ? `${coversToday} covers booked`
          : "no bookings yet",
        status: servicePhase === "during" ? "in_progress"
          : servicePhase === "after" ? "done"
          : "upcoming",
        timeLabel: servicePhase === "before" ? `opens ${svc.open}` : servicePhase === "after" ? `closed ${svc.close}` : svc.open,
        href: "/execute/floor",
      },
      {
        key: "eod",
        label: "EOD",
        detail: eod
          ? `revenue posted · ${eod.actual_covers || 0} covers`
          : servicePhase === "after"
          ? "post today's numbers"
          : "target 23:30",
        status: eod ? "done" : servicePhase === "after" ? "in_progress" : "upcoming",
        timeLabel: eod ? "done" : servicePhase === "after" ? undefined : "target 23:30",
        href: "/administrate/finance/eod",
      },
    ];

    // ---- alerts -----------------------------------------------------------
    const ec = ENTITY_CODE[entity];
    const alerts: CompassAlert[] = [];

    const myInvoices = invoiceInbox.filter((r) => r.entity_id === ec);
    for (const inv of myInvoices) {
      const supplier = (inv as any).supplier_name || "supplier";
      alerts.push({
        key: `inv-${inv.id}`,
        kicker: `Invoice · ${supplier}`,
        title: `€${Math.round(Number(inv.amount_eur || 0)).toLocaleString("en-GB")} waiting on your approval`,
        href: "/administrate/finance/scans",
      });
    }

    const myBank = bankOld.filter((r) => r.entity_id === ec);
    if (myBank.length) {
      alerts.push({
        key: `bank-${ec}`,
        kicker: "Bank · unmatched > 7d",
        title: `${myBank.length} movement${myBank.length === 1 ? "" : "s"} unmatched for more than a week`,
        href: "/administrate/finance/reconciliation",
      });
    }

    const myProposed = bankProposed.filter((r) => r.entity_code === ec);
    if (myProposed.length) {
      const highConf = myProposed.filter((r) => Number(r.top_confidence || 0) >= 0.9).length;
      const kicker = highConf > 0 ? "Bank · " + highConf + " ≥ 90% ready" : "Bank · matches to review";
      alerts.push({
        key: `bank-proposed-${ec}`,
        kicker,
        title: myProposed.length + " bank movement" + (myProposed.length === 1 ? "" : "s") + " with proposed matches waiting for review",
        href: "/administrate/finance/reconciliation",
      });
    }

    const myPlatform = platformBilling.filter((r) => r.entity_code === ec);
    for (const p of myPlatform) {
      const kicker = p.state === "disabled" ? `Platform · ${p.platform} disabled` : `Platform · ${p.platform}`;
      const title = p.notes ? String(p.notes).slice(0, 140) : `${p.platform} ${p.state}` + (Number(p.failure_count_30d || 0) > 0 ? ` · ${p.failure_count_30d} fails/30d` : "");
      alerts.push({
        key: `platform-${p.platform}-${ec}`,
        kicker,
        title,
        href: "/administrate/finance/payments",
      });
    }

    const myAnoms = financeAnomalies.filter((r) => r.entity_code === ec);
    if (myAnoms.length) {
      const sev4 = myAnoms.filter((r) => Number(r.severity || 0) >= 4).length;
      const kicker = sev4 > 0 ? "Anomalies · " + sev4 + " urgent" : "Anomalies · to triage";
      alerts.push({
        key: `anomalies-${ec}`,
        kicker,
        title: myAnoms.length + " finance anomal" + (myAnoms.length === 1 ? "y" : "ies") + " open — " + (myAnoms[0]?.description || "review the triage table").slice(0, 90),
        href: "/administrate/finance/anomalies",
      });
    }

    const myInbox = filesInboxRows.filter((r) => !r.suggested_entity || r.suggested_entity === ec);
    if (myInbox.length) {
      alerts.push({
        key: `files-inbox-${ec}`,
        kicker: "Files · to triage",
        title: myInbox.length + " file" + (myInbox.length === 1 ? "" : "s") + " awaiting triage — confirm category and file to the library",
        href: "/files/inbox",
      });
    }

    // cashToday is the "one number on Home" -- prefer today's manual EOD
    // revenue (if posted), fall back to yesterday's real POS gross.
    const cashToday = eod ? Number(eod.revenue || 0) : (yesterday ? yesterday.grossEur : null);

    return {
      label: ENTITY_LABEL[entity],
      now: { hhmm: now.hhmm, dateLabel },
      header: { coversBooked: coversToday, minutesToService, servicePhase },
      loop,
      alerts,
      alertsTotal: alerts.length,
      cashToday,
      highestImpact: masterTodos
        .filter((t) => !t.entity_code || t.entity_code === ec)
        .slice(0, 3)
        .map((t) => ({ id: t.id, title: String(t.title), impact_score: Number(t.impact_score || 3), due_at: t.due_at || null })),
      // -- v2 wire additions (real data, populated 2026-08-07) --
      yesterday,
      weather,
      month,
      upcoming30d: {
        count: futureCovers,
        next: nextBooking ? {
          date: String(nextBooking.service_date),
          time: nextBooking.service_time ? String(nextBooking.service_time).slice(0, 5) : null,
          party: Number(nextBooking.party_size || 0),
          name: nextBooking.guest_name || null,
        } : null,
      },
      cashPosition,
    };
  }

  const bm = compassFor(BM, "bistro_mondo");
  const taller = compassFor(TALLER, "taller");

  // Holdings = rolled-up. Loop is the merged view; alerts are combined.
  const holdingsAlerts = [...bm.alerts, ...taller.alerts];
  const holdings: CompassData["holdings"] = {
    label: "Ibiza Food Studios",
    now: { hhmm: now.hhmm, dateLabel },
    header: {
      coversBooked: bm.header.coversBooked + taller.header.coversBooked,
      minutesToService: bm.header.minutesToService,
      servicePhase: bm.header.servicePhase,
    },
    loop: bm.loop.map((s, i) => {
      const t = taller.loop[i];
      const both = s.status === "done" && t.status === "done";
      const any = s.status === "in_progress" || t.status === "in_progress";
      const status: LoopStep["status"] = both ? "done" : any ? "in_progress" : "upcoming";
      return { ...s, status, detail: `BM · ${s.detail}  ·  Taller · ${t.detail}` };
    }),
    alerts: holdingsAlerts,
    alertsTotal: holdingsAlerts.length,
    cashToday: (bm.cashToday || 0) + (taller.cashToday || 0),
    highestImpact: [...bm.highestImpact, ...taller.highestImpact].sort((a, b) => b.impact_score - a.impact_score).slice(0, 3),
    // v2 wire additions -- holdings is a roll-up
    yesterday: (bm.yesterday || taller.yesterday) ? {
      date: (bm.yesterday?.date || taller.yesterday?.date) as string,
      grossEur: (bm.yesterday?.grossEur || 0) + (taller.yesterday?.grossEur || 0),
      covers: (bm.yesterday?.covers || 0) + (taller.yesterday?.covers || 0),
      avgSpendEur: (() => {
        const g = (bm.yesterday?.grossEur || 0) + (taller.yesterday?.grossEur || 0);
        const c = (bm.yesterday?.covers || 0) + (taller.yesterday?.covers || 0);
        return c > 0 ? g / c : 0;
      })(),
    } : null,
    weather: bm.weather || taller.weather,
    month: (bm.month || taller.month) ? {
      thisGrossEur: (bm.month?.thisGrossEur || 0) + (taller.month?.thisGrossEur || 0),
      priorGrossEur: (bm.month?.priorGrossEur || taller.month?.priorGrossEur) != null
        ? (bm.month?.priorGrossEur || 0) + (taller.month?.priorGrossEur || 0)
        : null,
      deltaPct: null,
    } : null,
    upcoming30d: {
      count: bm.upcoming30d.count + taller.upcoming30d.count,
      next: [bm.upcoming30d.next, taller.upcoming30d.next]
        .filter(Boolean)
        .sort((a: any, b: any) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))[0] || null,
    },
    cashPosition: bm.cashPosition && taller.cashPosition ? {
      latestEur: (bm.cashPosition.latestEur || 0) + (taller.cashPosition.latestEur || 0),
      weekEnding: bm.cashPosition.weekEnding,
      apPendienteEur: (bm.cashPosition.apPendienteEur || 0) + (taller.cashPosition.apPendienteEur || 0),
    } : (bm.cashPosition || taller.cashPosition),
  };

  const data: CompassData = { holdings, bistro_mondo: bm, taller };
  return <HomeSwitch data={data} />;
}
