import HomeSwitch from "@/components/HomeSwitch";
import type { CompassData, LoopStep, CompassAlert } from "@/components/HomeCompass";
import { supabaseServer } from "@/lib/supabaseServer";
import { EntityKey, ENTITY_LABEL } from "@/lib/entities";

export const dynamic = "force-dynamic";

const BM = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
const TALLER = "ca83e06f-a24d-43d7-bce4-57ac341d190f";
const UT = "a0000000-0000-4000-8000-000000000001";

// Entity code used by the finance tables (invoice_inbox / bank_movements share BM / IFL / BBH).
const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };

// Assumed service window per venue — used to compute the service step state
// and the "service in Xh" copy. These match the current operating hours; if a
// venue reshapes, edit here (Boris: this could later come from a venue settings row).
const SERVICE_HOURS: Record<EntityKey, { open: string; close: string }> = {
  bistro_mondo: { open: "19:00", close: "23:30" },
  taller: { open: "19:00", close: "23:30" },
  utopia: { open: "19:00", close: "23:00" },
  holdings: { open: "19:00", close: "23:30" }, // synthetic (holdings is not a venue but keep the shape)
};

// Madrid wall-clock helper — server runs UTC.
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

export default async function Page() {
  const supabase = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const now = madridClock();
  const dateLabel = dateLabelMadrid();

  // -----------------------------------------------------------------------
  // Batch pull the tables we need for every venue in one call each. Cheap.
  // -----------------------------------------------------------------------
  const [
    eodTodayRes,
    bookingsRes,
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
    supabase.from("bookings").select("restaurant_id,party_size,status,service_date").eq("service_date", today),
    supabase.from("albarans").select("restaurant_id,received_at").gte("received_at", today + "T00:00:00").lt("received_at", today + "T23:59:59"),
    supabase.from("mep_dishes").select("zone_id,is_active,updated_at").eq("is_active", true),
    supabase.from("zones").select("id,restaurant_id"),
    // Any chef conversation today between 07:00–11:00 = morning-brief signal.
    supabase.from("assistant_conversations").select("user_id,created_at").gte("created_at", today + "T07:00:00").lt("created_at", today + "T11:00:00"),
    // Alerts sources — invoice_inbox big-ticket without match, bank_movements unmatched
    // (age > 7d), platform_billing_status failing/disabled.
    supabase.from("invoice_inbox").select("id,entity_id,amount_eur,sender:provider_id(name),arrived_at").gt("amount_eur", 500).not("match_status", "in", "(approved,rejected,duplicate)"),
    supabase.from("bank_movements").select("id,entity_id,amount_eur,description,movement_date,reconciled_to").eq("reconciled_to", "unmatched"),
    supabase.from("platform_billing_status").select("entity_code,platform,state,notes,failure_count_30d,last_failure_at").in("state", ["failing", "disabled"]),
    supabase.from("v_finance_anomalies_open").select("id,entity_code,kind,severity,description").gte("severity", 3),
    // Bank matches that have a proposed candidate waiting for the operator to accept / reject.
    supabase.from("v_bank_matches_open").select("movement_id,entity_code,top_confidence").not("top_candidate_id", "is", null),
    // PA integration Sprint 1 — Master_ToDo highest-impact open rows for the strip.
    supabase.from("master_todos").select("id,title,impact_score,entity_code,due_at").not("status", "in", "(completed,deferred)").order("impact_score", { ascending: false }).limit(30),
    // Files inbox — needs_triage counter per entity for the compass alerts strip.
    supabase.from("files_inbox").select("suggested_entity,status").eq("status", "needs_triage").limit(500),
  ]);

  // Some of the newer tables may not exist yet in every environment; treat null as empty.
  const eodRows: any[] = eodTodayRes.data || [];
  const bookings: any[] = bookingsRes.data || [];
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
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const bankOld = bankUnmatched.filter((r) => (r.movement_date || "") <= sevenDaysAgo);

  const zonesByRestaurant = new Map<string, string[]>();
  for (const z of zones) {
    const arr = zonesByRestaurant.get(z.restaurant_id) || [];
    arr.push(z.id);
    zonesByRestaurant.set(z.restaurant_id, arr);
  }

  // -----------------------------------------------------------------------
  // Compute compass state for a single restaurant / entity.
  // -----------------------------------------------------------------------
  function compassFor(rid: string, entity: EntityKey) {
    const eod = eodRows.find((e) => e.restaurant_id === rid);
    const covers = bookings
      .filter((b) => b.restaurant_id === rid && !["cancelled", "no_show"].includes((b.status || "").toLowerCase()))
      .reduce((a, b) => a + Number(b.party_size || 0), 0);
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
        // Prep is "in progress" while there are dishes AND we're pre-service.
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
          : covers > 0
          ? `${covers} covers booked`
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
      const supplier = (inv.sender as any)?.name || "supplier";
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

    // Bank matches proposed by the matcher waiting for the operator to accept.
    // (Distinct from the "> 7d" alert above — this one fires the instant a
    // candidate is produced so the operator can bulk-accept high-confidence
    // rows without letting them age.)
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

    // Finance anomalies — surface the count as a compass alert. The detail
    // page /administrate/finance/anomalies has the full triage table + drawer.
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

    // Files inbox — attachments waiting for a manual category / entity /
    // title confirmation before promotion to the library. Include rows
    // suggested for this entity plus un-classified rows (which every
    // operator can help route).
    const myInbox = filesInboxRows.filter((r) => !r.suggested_entity || r.suggested_entity === ec);
    if (myInbox.length) {
      alerts.push({
        key: `files-inbox-${ec}`,
        kicker: "Files · to triage",
        title: myInbox.length + " file" + (myInbox.length === 1 ? "" : "s") + " awaiting triage — confirm category and file to the library",
        href: "/files/inbox",
      });
    }

    return {
      label: ENTITY_LABEL[entity],
      now: { hhmm: now.hhmm, dateLabel },
      header: { coversBooked: covers, minutesToService, servicePhase },
      loop,
      alerts,
      alertsTotal: alerts.length,
      cashToday: eod ? Number(eod.revenue || 0) : null,
      highestImpact: masterTodos
        .filter((t) => !t.entity_code || t.entity_code === ec)
        .slice(0, 3)
        .map((t) => ({ id: t.id, title: String(t.title), impact_score: Number(t.impact_score || 3), due_at: t.due_at || null })),
    };
  }

  const bm = compassFor(BM, "bistro_mondo");
  const taller = compassFor(TALLER, "taller");
  const utopia = compassFor(UT, "utopia");

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
    // Roll-up loop steps: done only if both venues done; in-progress if any.
    loop: bm.loop.map((s, i) => {
      const t = taller.loop[i];
      const both = s.status === "done" && t.status === "done";
      const any = s.status === "in_progress" || t.status === "in_progress";
      const status: LoopStep["status"] = both ? "done" : any ? "in_progress" : "upcoming";
      return {
        ...s,
        status,
        detail: `BM · ${s.detail}  ·  Taller · ${t.detail}`,
      };
    }),
    alerts: holdingsAlerts,
    alertsTotal: holdingsAlerts.length,
    cashToday: (bm.cashToday || 0) + (taller.cashToday || 0),
    highestImpact: [...bm.highestImpact, ...taller.highestImpact].sort((a, b) => b.impact_score - a.impact_score).slice(0, 3),
  };

  const data: CompassData = { holdings, bistro_mondo: bm, taller, utopia };
  return <HomeSwitch data={data} />;
}
