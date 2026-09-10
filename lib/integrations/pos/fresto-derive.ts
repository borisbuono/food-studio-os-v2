// Fresto derivation helpers — the ONE place a trading date is decided
// from a raw Fresto row, and the ONE place hourly / mix / turnover
// metrics are computed. Every consumer (writer, backfill script, tests)
// imports from here.
//
// Why "one place": three consecutive nights we shipped the same class of
// bug — a date rule applied in one consumer and not the neighbouring one
// (see memory: derived_date_computed_once). This module IS that helper.
//
// Two things belong here:
//
//   1) `resolveTradingDate(pulledAt, businessDateLabel)` — Fresto's
//      `businessDate` field was shifted +1 day server-side on 2026-09-07.
//      Post-fix labels are the trading-night truth. Pre-fix cached NI
//      dumps carry a label that is ONE DAY EARLIER than the actual
//      trading night. Every caller reading a historical dump routes
//      through this helper; every live-API caller can pass the same
//      helper and get back the label unchanged.
//
//   2) `derivePosMetrics(orderlines, orders, zRaw, bookings, bookingsDaily)`
//      — hourly split, payment mix, salepoint mix, productgroup mix,
//      distinct_waiters, avg spend, peak hour, turnover ratio. Pure
//      function, deterministic, unit-testable.
//
// Nothing here touches Supabase or the network. Adapters live in fresto.ts.

import type { FrestoOrderline, FrestoOrder, FrestoZReport } from "./fresto";

// ============================================================================
// 1) businessDate offset — the ONE derived-date function
// ============================================================================

// The exact moment Fresto shifted the server-side field. Pulls with
// `pulledAt >= FRESTO_BDATE_FIX_TS` carry the CORRECT label; pulls before
// need +1 day applied to reach the true trading night.
export const FRESTO_BDATE_FIX_TS = new Date("2026-09-07T00:00:00Z");

// Given the businessDate label on a raw row (and, optionally, the row's own
// close/event timestamp), return the true trading date as YYYY-MM-DD.
//
// Correction (2026-09-10): `pulledAt` is NOT the right pivot. The server
// mutation was applied to closings going forward at 2026-09-07 — but
// historical rows stored BEFORE that moment keep their original day-early
// labels no matter when we fetch them. Using pulledAt made a 09-09 backfill
// of a July z return the day-early label as-is (see memory
// `os_fresto_z_raw_trading_date_one_day_early_09-10`, seed only,
// re-key needed). The correct pivot is when the ROW itself was sealed:
// prefer an explicit event timestamp (z.toDate is ideal — that's when the
// close hit the server); fall back to the businessDate label as the best
// day-precision proxy.
//
// - if the record's event happened before FRESTO_BDATE_FIX_TS → label was
//   assigned pre-fix (day-early) → add +1 day
// - if the record's event happened at/after FRESTO_BDATE_FIX_TS → label is
//   the true trading day → pass through unchanged
// - null / missing label → null
//
// `pulledAt` kept for signature backward-compat with earlier call sites,
// but is ignored. Callers with a per-row event-timestamp (z.toDate,
// order/orderline creation ts) should pass it as `eventTs`.
export function resolveTradingDate(
  pulledAt: Date | string | null | undefined,
  businessDateLabel: string | null | undefined,
  eventTs?: Date | string | null | undefined,
): string | null {
  void pulledAt; // intentionally unused — see comment above.
  if (!businessDateLabel) return null;
  const label = String(businessDateLabel).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return null;

  // Resolve the pivot moment for this ROW: prefer an explicit event
  // timestamp (z.toDate is ideal). Fall back to noon-UTC of the label
  // (a stable day-precision proxy for when the label was assigned).
  const evt = eventTs ? (typeof eventTs === "string" ? new Date(eventTs) : eventTs) : null;
  const pivot = evt && !isNaN(evt.getTime()) ? evt : new Date(label + "T12:00:00Z");
  const isPostFix = pivot >= FRESTO_BDATE_FIX_TS;
  if (isPostFix) return label;

  // Pre-fix label — add +1 day to reach the true trading night.
  const d = new Date(label + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Extract "YYYY-MM-DD" from an ISO-ish string. Used everywhere for
// Fresto's z.fromDate/toDate handling.
export function isoDatePart(s: string | undefined | null): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Extract HH (Madrid) from an ISO timestamp. Fresto returns UTC-ish
// timestamps ending Z; the hour-of-day for hourly bucketing must be in
// Madrid so 20:00 CET reads as "20", not "18". We derive with
// Intl.DateTimeFormat so DST is automatic.
const HH_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", hour: "2-digit", hour12: false,
});
export function madridHour(ts: string | undefined | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  // "00".."23"
  const h = HH_FMT.format(d).padStart(2, "0");
  return h;
}

// ============================================================================
// 2) Booking shapes — Fresto's response fields (best-effort; unknown fields tolerated)
// ============================================================================

export interface FrestoBookingLike {
  id?: string;
  businessDate?: string;
  guests?: number;
  status?: string;              // approved | closed | cancelled
  fromDate?: string;            // start ts
  toDate?: string;              // end ts
  tableID?: string;
}

export interface FrestoBookingsDailyLike {
  businessDate?: string;
  guests?: number;              // physical people that day (walk-ins included)
}

// ============================================================================
// 3) Derived POS metrics
// ============================================================================

export interface DerivedPosMetrics {
  tickets: number;
  orders_count: number | null;
  tables_count: number | null;
  distinct_waiters: number | null;
  hourly_revenue: Record<string, number>;
  hourly_orders: Record<string, number>;
  hourly_covers: Record<string, number>;
  payment_mix: Record<string, number>;
  salepoint_mix: Record<string, number>;
  productgroup_mix: Record<string, number>;
  peak_hour: string | null;
  peak_hour_revenue: number;
  guests_booked: number | null;
  guests_daily: number | null;
  guests_walkins: number | null;
  avg_spend_per_guest: number | null;
  avg_ticket_size: number | null;
  turnover_ratio: number | null;
  z_spans_days: boolean;
  total_gross_eur: number;
  cash_declared_eur: number | null;
  card_declared_eur: number | null;
  tips_eur: number | null;
}

// Pure derivation. Every caller passes the already-filtered rows for a
// single trading date and gets back the whole derived shape in one go.
//
// Inputs use the raw Fresto shapes so callers don't have to re-map.
export function derivePosMetrics(input: {
  orderlines: FrestoOrderline[];
  orders: FrestoOrder[];
  zRaw: FrestoZReport[];
  bookings?: FrestoBookingLike[];
  bookingsDaily?: FrestoBookingsDailyLike | null;
}): DerivedPosMetrics {
  const orderlines = input.orderlines || [];
  const orders = input.orders || [];
  const zRaw = input.zRaw || [];
  const bookings = input.bookings || [];
  const bookingsDaily = input.bookingsDaily || null;

  // ---- tickets, orders_count, tables_count, distinct_waiters ----
  // Round to whole item count (Fresto tolerates fractional weight-based
  // items; operator instinct is the integer).
  const tickets = Math.round(orderlines.reduce((s, l) => s + Number(l.quantity || 0), 0));

  const orderIds = new Set<string>();
  const waiterIds = new Set<string>();
  const spByRev = new Map<string, number>();
  const pgByRev = new Map<string, number>();

  for (const l of orderlines) {
    if (l.orderID) orderIds.add(l.orderID);
    if ((l as any).userID) waiterIds.add(String((l as any).userID));
    const price = Number(l.price || 0);
    if ((l as any).salePointID) {
      const sp = String((l as any).salePointID);
      spByRev.set(sp, (spByRev.get(sp) || 0) + price);
    }
    if ((l as any).productGroupID) {
      const pg = String((l as any).productGroupID);
      pgByRev.set(pg, (pgByRev.get(pg) || 0) + price);
    }
  }

  const orders_count = orderIds.size || null;
  const distinct_waiters = waiterIds.size || null;

  const tableIds = new Set<string>();
  for (const o of orders) if ((o as any).tableID) tableIds.add(String((o as any).tableID));
  const tables_count = tableIds.size || null;

  const salepoint_mix: Record<string, number> = {};
  for (const [k, v] of spByRev) salepoint_mix[k] = round2(v);
  const productgroup_mix: Record<string, number> = {};
  for (const [k, v] of pgByRev) productgroup_mix[k] = round2(v);

  // ---- hourly split (Madrid HH) ----
  //
  // Orderlines carry a `created` timestamp when Fresto returns it (may be
  // called `created`, `createdAt`, `createdTS`, or `insertTS` across
  // tenants). We check the known keys in order and skip lines that lack
  // any of them (they still count into the day total but not into the
  // hourly bucket). If NO orderline has a timestamp, hourly_revenue is
  // empty — the caller decides to hide the sparkline in that case.
  const hourly_revenue: Record<string, number> = {};
  const hourly_orders: Record<string, number> = {};
  const seenOrdersByHour = new Map<string, Set<string>>();
  for (const l of orderlines) {
    const ts = pickLineTimestamp(l);
    const hh = madridHour(ts);
    if (!hh) continue;
    hourly_revenue[hh] = round2((hourly_revenue[hh] || 0) + Number(l.price || 0));
    if (l.orderID) {
      const set = seenOrdersByHour.get(hh) || new Set<string>();
      set.add(l.orderID);
      seenOrdersByHour.set(hh, set);
    }
  }
  for (const [hh, set] of seenOrdersByHour) hourly_orders[hh] = set.size;

  // hourly_covers — from bookings that touch each hour. Naive rule:
  // a booking with guests=N contributes N to every hour between its
  // start and end. Fresto sometimes reports only start; fall back to
  // a two-hour occupancy assumption (industry-standard turn time).
  const hourly_covers: Record<string, number> = {};
  for (const b of bookings) {
    const status = (b.status || "").toLowerCase();
    if (status && status !== "approved" && status !== "closed" && status !== "confirmed") continue;
    const g = Number(b.guests || 0);
    if (!g) continue;
    const startHH = madridHour(b.fromDate);
    if (!startHH) continue;
    const endHH = madridHour(b.toDate) || addHours(startHH, 2);
    for (const hh of hoursBetween(startHH, endHH)) {
      hourly_covers[hh] = (hourly_covers[hh] || 0) + g;
    }
  }

  // peak hour
  let peak_hour: string | null = null;
  let peak_hour_revenue = 0;
  for (const [hh, rev] of Object.entries(hourly_revenue)) {
    if (rev > peak_hour_revenue) { peak_hour_revenue = rev; peak_hour = hh; }
  }
  peak_hour_revenue = round2(peak_hour_revenue);

  // ---- z-report aggregation + multi-day detection ----
  let z_spans_days = false;
  let cashRevenue = 0, cardsTotal = 0, onlineCardsTotal = 0, tips = 0, zRevenue = 0;
  for (const z of zRaw) {
    const from = isoDatePart((z as any).fromDate);
    const to = isoDatePart((z as any).toDate);
    if (from && to && from !== to) z_spans_days = true;
    cashRevenue += Number((z as any).cashRevenue || 0);
    cardsTotal += Number((z as any).cardsTotal || 0);
    onlineCardsTotal += Number((z as any).onlineCardsTotal || 0);
    tips += Number((z as any).tips || 0);
    zRevenue += Number((z as any).revenue || 0);
  }
  // "Offline" in Fresto's terminology bundles Comercia card revenue that
  // the ledger sees at bank. We keep it as its own key so the Studio
  // card can render the mix accurately when needed.
  const offline = round2((cardsTotal || 0));
  const payment_mix: Record<string, number> = {
    Cash: round2(cashRevenue),
    Cards: offline,
    OnlineCards: round2(onlineCardsTotal),
    Tips: round2(tips),
  };
  // total gross prefers z-sum; falls back to orderlines
  const orderlinesTotal = orderlines.reduce((s, l) => s + Number(l.price || 0), 0);
  const total_gross_eur = round2(zRevenue || orderlinesTotal);

  const cash_declared_eur = z_spans_days ? null : round2(cashRevenue || 0);
  const card_declared_eur = z_spans_days ? null : round2((cardsTotal || 0) + (onlineCardsTotal || 0));
  const tips_eur = z_spans_days ? null : round2(tips || 0);

  // ---- guests: physical people ----
  //
  // guests_daily = bookings/daily.guests (walk-ins included) — the truth
  // if the endpoint is available and returned a number.
  //
  // guests_booked = SUM(bookings.guests) where status is accepted / closed
  // (case-insensitive). Skips cancelled + no-show.
  //
  // guests_walkins = daily - booked when both are present; else null.
  const guests_daily = bookingsDaily?.guests != null ? Number(bookingsDaily.guests) : null;
  let guests_booked: number | null = null;
  if (bookings.length) {
    let sum = 0, any = false;
    for (const b of bookings) {
      const s = (b.status || "").toLowerCase();
      if (s === "cancelled" || s === "no-show" || s === "noshow") continue;
      const g = Number(b.guests || 0);
      if (g > 0) { sum += g; any = true; }
    }
    guests_booked = any ? sum : null;
  }
  const guests_walkins = (guests_daily != null && guests_booked != null)
    ? Math.max(0, guests_daily - guests_booked)
    : null;

  // ---- averages + turnover ----
  const guestsForAvg = guests_daily ?? null;
  const avg_spend_per_guest = (guestsForAvg && guestsForAvg > 0) ? round2(total_gross_eur / guestsForAvg) : null;
  const avg_ticket_size = (orders_count && orders_count > 0) ? round2(total_gross_eur / orders_count) : null;
  const turnover_ratio = (tables_count && tables_count > 0 && orders_count)
    ? round2(orders_count / tables_count) : null;

  return {
    tickets,
    orders_count,
    tables_count,
    distinct_waiters,
    hourly_revenue,
    hourly_orders,
    hourly_covers,
    payment_mix,
    salepoint_mix,
    productgroup_mix,
    peak_hour,
    peak_hour_revenue,
    guests_booked,
    guests_daily,
    guests_walkins,
    avg_spend_per_guest,
    avg_ticket_size,
    turnover_ratio,
    z_spans_days,
    total_gross_eur,
    cash_declared_eur,
    card_declared_eur,
    tips_eur,
  };
}

// ---------- helpers ----------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickLineTimestamp(l: any): string | null {
  return String(l?.created || l?.createdAt || l?.createdTS || l?.insertTS || l?.timestamp || "") || null;
}

function addHours(hh: string, delta: number): string {
  const n = ((parseInt(hh, 10) + delta) + 24) % 24;
  return String(n).padStart(2, "0");
}

// Inclusive on start, exclusive on end. If end == start, just returns [start].
// Wraps across midnight (03:00 close → last hour bucket is 02).
function hoursBetween(startHH: string, endHH: string): string[] {
  const out: string[] = [];
  let cur = parseInt(startHH, 10);
  const end = parseInt(endHH, 10);
  // Guard: max 24 iterations
  for (let i = 0; i < 24; i++) {
    out.push(String(cur).padStart(2, "0"));
    cur = (cur + 1) % 24;
    if (cur === end) break;
  }
  return out;
}
