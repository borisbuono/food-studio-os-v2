import * as XLSX from "xlsx";
import type { PosAdapter, PosDailySale, PosSaleLine, EntityCode } from "@/lib/integrations/types";
import {
  resolveTradingDate,
  derivePosMetrics,
  isoDatePart as _isoDatePart,
  type FrestoBookingLike,
  type FrestoBookingsDailyLike,
} from "./fresto-derive";

// Fresto POS adapter.
//
// Two paths coexist:
//  1) Live: OAuth 2.0 (Client Credentials) against https://data.fresto.io/data-api-service.
//     Boris pastes client_id + client_secret per venue into Vercel env vars:
//        FRESTO_CLIENT_ID_{IFL,BM,BBH}
//        FRESTO_CLIENT_SECRET_{IFL,BM,BBH}
//     Docs: https://docs.fresto.io/  (redoc UI, spec at /data-fresto.yaml)
//  2) Fallback: the XLSX upload the operator dashboard has always exported — kept intact
//     so manual EOD entry never breaks if the API is down / creds not set / a venue
//     isn't yet on the API.
//
// The XLSX shape has one row per day: date | food | wine | bar | softdrinks | tips | total.
// Headers are normalised for resilience across Spanish/English exports.
//
// ------------------------------------------------------------------------
// Boris walk 2026-08-31 18:15 CET — tickets vs guests split
// ------------------------------------------------------------------------
// The Fresto API has NO guest field anywhere. What we USED to write into
// eod_pos.covers was z.quantity — the count of items on the ticket, not
// people. A pair of guests ordering two mains, two glasses of wine and a
// coffee is 5 "tickets" on Fresto, 2 guests in the dining room.
//
// This writer now emits both signals separately:
//   • tickets       = SUM(quantity) from /sales/orderlines
//   • orders_count  = COUNT(DISTINCT orderID) from /sales/orderlines
//   • tables_count  = COUNT(DISTINCT tableID) from /sales/orders (best-effort)
//   • guests        = NOT WRITTEN HERE. Manual entry or email parse only.
//
// It also flags multi-day z-reports (a z whose fromDate.date != toDate.date
// aggregates cash across the span onto a single business day). When that
// happens we null cash/card/tips and set z_spans_days=true so the Studio
// card can render a SPAN pill rather than lie about the day's cash.

// ---------- 1) XLSX fallback (unchanged public shape) ----------

const HEADER_ALIASES: Record<string, string> = {
  fecha: "date", day: "date", date: "date",
  comida: "food", food: "food", "food sales": "food",
  vino: "wine", wine: "wine",
  bar: "bar", barra: "bar", "alcohol": "bar",
  refresco: "softdrinks", refrescos: "softdrinks", soft: "softdrinks", softdrinks: "softdrinks", "soft drinks": "softdrinks",
  propinas: "tips", tips: "tips", tip: "tips",
  total: "total",
  cubiertos: "covers", covers: "covers",
  efectivo: "cash", cash: "cash",
  tarjeta: "card", card: "card",
};

function normalizeHeader(h: any): string {
  return HEADER_ALIASES[String(h || "").trim().toLowerCase()] || String(h || "").toLowerCase();
}

export function parseFrestoXlsx(buf: ArrayBuffer): { date: string; covers: number; food: number; wine: number; bar: number; softdrinks: number; tips: number; total: number; cash: number; card: number }[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (raw.length < 2) return [];

  const headers = raw[0].map(normalizeHeader);
  const idx = (k: string) => headers.indexOf(k);
  const out: any[] = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row.length) continue;
    const dateCell = row[idx("date")];
    if (!dateCell) continue;
    const date = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell).slice(0, 10);
    const num = (k: string) => {
      const j = idx(k); if (j < 0) return 0;
      const v = row[j];
      const n = typeof v === "number" ? v : Number(String(v || "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    out.push({
      date,
      covers: Math.round(num("covers")),
      food: num("food"),
      wine: num("wine"),
      bar: num("bar"),
      softdrinks: num("softdrinks"),
      tips: num("tips"),
      total: num("total"),
      cash: num("cash"),
      card: num("card"),
    });
  }
  return out;
}

// Persist a parsed Fresto XLSX row to eod_pos. Idempotent per (restaurant_id,
// date, source). The XLSX export's "cubiertos" column in the Spanish
// operator dashboard IS a physical guest count, so we write it to
// guests (source='import'), NOT to tickets — tickets is only populated
// by the API pull path where z.quantity is item count.
export async function persistFrestoRowToPos(params: {
  restaurant_id: string;
  row: ReturnType<typeof parseFrestoXlsx>[number];
  source_ref?: string | null;
  imported_by?: string | null;
  raw_payload?: any;
}): Promise<{ id: string; existed: boolean }> {
  const { supabaseServer } = await import("@/lib/supabaseServer");
  const sb = supabaseServer();
  const { row } = params;
  const found = await sb.from("eod_pos")
    .select("id")
    .eq("restaurant_id", params.restaurant_id)
    .eq("date", row.date)
    .eq("source", "fresto")
    .maybeSingle();
  if (found.data?.id) return { id: found.data.id, existed: true };

  const ins = await sb.from("eod_pos").insert({
    restaurant_id: params.restaurant_id,
    date: row.date,
    source: "fresto",
    source_ref: params.source_ref || null,
    covers: null,
    guests: row.covers && row.covers > 0 ? row.covers : null,
    guests_source: row.covers && row.covers > 0 ? "import" : null,
    tickets: null,
    orders_count: null,
    tables_count: null,
    food_net_eur: row.food || 0,
    wine_net_eur: row.wine || 0,
    bar_net_eur: row.bar || 0,
    softdrinks_net_eur: row.softdrinks || 0,
    tips_eur: row.tips || 0,
    service_charge_eur: 0,
    cash_declared_eur: row.cash || 0,
    card_declared_eur: row.card || 0,
    total_gross_eur: row.total || 0,
    imported_by: params.imported_by || null,
    raw_payload: (params.raw_payload ?? row) as any,
  }).select("id").single();
  if (ins.error) throw new Error("eod_pos insert failed: " + ins.error.message);
  return { id: ins.data.id, existed: false };
}

// ---------- 2) Live Fresto API — OAuth 2.0 Client Credentials ----------
//
// Per-entity credentials come from process.env. We deliberately do NOT hardcode any
// value here — Vercel is the source of truth. Missing creds → callers get null and
// fall back to XLSX / manual EOD.
//
// Cross-invocation caching is best-effort (globalThis) — tokens are per-entity, expire
// after ~2h (Fresto returns expires_in seconds), and we refresh with a 60s safety
// margin. 401 from downstream endpoints triggers a single force-refresh + retry.

export const FRESTO_API_BASE = "https://data.fresto.io/data-api-service";
export const FRESTO_DRY_RUN = () => String(process.env.FS_FRESTO_DRY_RUN || "").toLowerCase() === "true";

export interface FrestoCredentials {
  entity: EntityCode;
  client_id: string;
  client_secret: string;
}

export function getFrestoCredentials(entity: EntityCode): FrestoCredentials | null {
  const id = process.env[`FRESTO_CLIENT_ID_${entity}`];
  const secret = process.env[`FRESTO_CLIENT_SECRET_${entity}`];
  if (!id || !secret) return null;
  return { entity, client_id: id, client_secret: secret };
}

export function frestoStatus(entity: EntityCode): "connected" | "not-configured" {
  return getFrestoCredentials(entity) ? "connected" : "not-configured";
}

type TokenSlot = { token: string; expires_at_ms: number; entity: EntityCode };
const TOKEN_CACHE_KEY = "__fs_fresto_token_cache_v1__";
function tokenCache(): Map<EntityCode, TokenSlot> {
  const g: any = globalThis as any;
  if (!g[TOKEN_CACHE_KEY]) g[TOKEN_CACHE_KEY] = new Map<EntityCode, TokenSlot>();
  return g[TOKEN_CACHE_KEY] as Map<EntityCode, TokenSlot>;
}

export async function getFrestoToken(entity: EntityCode, opts?: { forceRefresh?: boolean }): Promise<string> {
  const cache = tokenCache();
  const now = Date.now();
  if (!opts?.forceRefresh) {
    const hit = cache.get(entity);
    if (hit && hit.expires_at_ms > now + 60_000) return hit.token;
  }
  const creds = getFrestoCredentials(entity);
  if (!creds) throw new FrestoNotConfigured(entity);

  const r = await fetch(`${FRESTO_API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`fresto oauth /auth/token → ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json() as { access_token: string; token_type?: string; expires_in?: number };
  if (!j?.access_token) throw new Error("fresto oauth: response missing access_token");
  const ttl = Math.max(60, Number(j.expires_in || 7200));
  cache.set(entity, { token: j.access_token, expires_at_ms: now + ttl * 1000, entity });
  return j.access_token;
}

export class FrestoNotConfigured extends Error {
  constructor(entity: EntityCode) { super(`fresto: no credentials for ${entity} — set FRESTO_CLIENT_ID_${entity} + FRESTO_CLIENT_SECRET_${entity}`); this.name = "FrestoNotConfigured"; }
}

// Shared request helper with 401→refresh-once, 429→backoff, 5xx→surface.
async function frestoGet<T>(entity: EntityCode, path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(FRESTO_API_BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

  const doFetch = async (token: string) => fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${token}` },
    cache: "no-store",
  });

  let token = await getFrestoToken(entity);
  let r = await doFetch(token);

  if (r.status === 401) {
    token = await getFrestoToken(entity, { forceRefresh: true });
    r = await doFetch(token);
  }
  // Simple 429 exponential backoff — Fresto docs don't specify the rate window;
  // conservative default: up to 3 retries at 500ms / 1.5s / 4.5s.
  let attempt = 0;
  while (r.status === 429 && attempt < 3) {
    const wait = 500 * Math.pow(3, attempt);
    await new Promise((res) => setTimeout(res, wait));
    r = await doFetch(token);
    attempt++;
  }
  if (r.status >= 500) {
    const text = await r.text().catch(() => "");
    throw new Error(`fresto ${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`fresto ${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

// ---------- Fresto response shapes (from docs.fresto.io / data-fresto.yaml) ----------

export interface FrestoOrderline {
  businessDate?: string;
  id?: string;
  title?: string;
  productID?: string;
  isRevenue?: 0 | 1;
  price?: number;
  quantity?: number;
  profit?: number;
  cost?: number;
  userID?: string;
  orderID?: string;
  salePointID?: string;
  slug?: string;
  cancelled?: 0 | 1;
  productGroupID?: string;
  vatAccountingCode?: string;
  vatPct?: number;
  productAccountingCode?: string;
}

export interface FrestoOrder {
  id?: string;
  slug?: string;
  businessDate?: string;
  tableID?: string;
  tableName?: string;
  quantity?: number;
  revenue?: number;
  cancelled?: 0 | 1;
}

export interface FrestoZReport {
  id?: string;
  slug?: string;
  userID?: string;
  fromDate?: string;
  toDate?: string;
  created?: string;
  revenue?: number;
  vatAmount?: number;
  effectiveRevenue?: number;
  quantity?: number;
  cashBalance?: number;
  cashDeposited?: number;
  cashRevenue?: number;
  cashTips?: number;
  cashTotal?: number;
  countedCash?: number;
  discountTotal?: number;
  invoicedTotal?: number;
  reconciliation?: number;
  nextReconciliation?: number;
  soldGiftCardsTotal?: number;
  appliedGiftCardsTotal?: number;
  surcharge?: number;
  tips?: number;
  walletsTotal?: number;
  cardsTotal?: number;
  onlineCardsTotal?: number;
  refundTotal?: number;
  onlineRevenue?: number;
  onlineQuantity?: number;
  posRevenue?: number;
  posQuantity?: number;
  comment?: string;
}

export interface FrestoSalesDay {
  slug?: string;
  businessDate?: string;
  revenue?: number;
  vatAmount?: number;
  posRevenue?: number;
  onlineRevenue?: number;
  barRevenue?: number;
  kitchenRevenue?: number;
  orders?: number;
  posOrders?: number;
  onlineOrders?: number;
  surcharge?: number;
  tips?: number;
}

// ---------- Public API methods ----------

// Extract "YYYY-MM-DD" from an ISO-ish string. Now imported from the
// derive helper (single source of truth) — kept aliased here so the
// existing local callers don't have to know.
const isoDatePart = _isoDatePart;

// Pull all orderlines for a businessDate. Fresto's per-day filter is
// `?businessDate=D` which is authoritative — it pins each line to the
// business day the operator chose at close time (handles the 03:00-next-
// morning case correctly).
export async function pullOrderlinesForDay(entity: EntityCode, date: string): Promise<FrestoOrderline[]> {
  if (FRESTO_DRY_RUN()) return [];
  const creds = getFrestoCredentials(entity);
  if (!creds) return [];
  // We still pass startDate/endDate for the historic behaviour and
  // businessDate for the exact per-day pin. The Fresto API tolerates
  // both being present; the narrowest predicate wins.
  const resp = await frestoGet<{ data: FrestoOrderline[] }>(entity, "/sales/orderlines", {
    startDate: date, endDate: date, businessDate: date, pagesize: 5000,
  });
  return (resp?.data || []).filter((l) => (l.isRevenue ?? 1) === 1 && (l.cancelled ?? 0) === 0);
}

// Pull orders for the day — used only for tables_count. Best-effort; if
// the endpoint isn't available for a tenant we return an empty list and
// tables_count stays null.
export async function pullOrdersForDay(entity: EntityCode, date: string): Promise<FrestoOrder[]> {
  if (FRESTO_DRY_RUN()) return [];
  const creds = getFrestoCredentials(entity);
  if (!creds) return [];
  try {
    const resp = await frestoGet<{ data: FrestoOrder[] }>(entity, "/sales/orders", {
      businessDate: date, pagesize: 5000,
    });
    return (resp?.data || []).filter((o) => (o.cancelled ?? 0) === 0);
  } catch {
    return [];
  }
}

// Kept for surface compatibility. Emits the canonical PosDailySale shape
// used by the older adapter surface — the writer path (persistPullToPos)
// no longer calls this; it goes direct to orderlines + z's for exactness.
export async function pullDay(entity: EntityCode, restaurant_id: string, date: string): Promise<PosDailySale | null> {
  if (FRESTO_DRY_RUN()) {
    return {
      date, restaurant_id, covers: 0, lines: [], total_eur: 0,
      source: { adapter: "fresto", raw_ref: "dry-run" },
    };
  }
  const creds = getFrestoCredentials(entity);
  if (!creds) return null;

  const lines = await pullOrderlinesForDay(entity, date);
  const bucket = { food: 0, wine: 0, bar: 0, softdrinks: 0, tips: 0 };
  let total = 0;
  for (const ol of lines) {
    const price = Number(ol.price || 0);
    total += price;
    const vat = Number(ol.vatPct || 0);
    if (vat >= 20) bucket.bar += price;
    else bucket.food += price;
  }
  const posLines: PosSaleLine[] = [
    { group: "food",       net_eur: bucket.food,       vat_rate: 10, vat_eur: bucket.food * 0.10 },
    { group: "wine",       net_eur: bucket.wine,       vat_rate: 10, vat_eur: bucket.wine * 0.10 },
    { group: "bar",        net_eur: bucket.bar,        vat_rate: 21, vat_eur: bucket.bar * 0.21 },
    { group: "softdrinks", net_eur: bucket.softdrinks, vat_rate: 10, vat_eur: bucket.softdrinks * 0.10 },
    { group: "tips",       net_eur: bucket.tips,       vat_rate: 0,  vat_eur: 0 },
  ];
  return {
    date, restaurant_id, covers: 0, lines: posLines, total_eur: total,
    source: { adapter: "fresto", raw_ref: `orderlines:${date}` },
  };
}

// Pull the z-report(s) for a date. If any is multi-day (fromDate.date !=
// toDate.date) the cash/card figures cover multiple business days and
// can't be trusted for the single day — we surface that so the writer
// can flag z_spans_days and null cash/card.
export async function pullZReport(entity: EntityCode, date: string): Promise<FrestoZReport | null> {
  if (FRESTO_DRY_RUN()) return null;
  const creds = getFrestoCredentials(entity);
  if (!creds) return null;
  const resp = await frestoGet<{ data: FrestoZReport[] }>(entity, "/sales/z-reports", { startDate: date, endDate: date });
  const arr = resp?.data || [];
  if (!arr.length) return null;
  const agg: FrestoZReport = { fromDate: date, toDate: date, revenue: 0, cashRevenue: 0, cardsTotal: 0, tips: 0, vatAmount: 0, discountTotal: 0, refundTotal: 0, quantity: 0 };
  for (const z of arr) {
    agg.revenue = (agg.revenue || 0) + (z.revenue || 0);
    agg.cashRevenue = (agg.cashRevenue || 0) + (z.cashRevenue || 0);
    agg.cardsTotal = (agg.cardsTotal || 0) + (z.cardsTotal || 0);
    agg.tips = (agg.tips || 0) + (z.tips || 0);
    agg.vatAmount = (agg.vatAmount || 0) + (z.vatAmount || 0);
    agg.discountTotal = (agg.discountTotal || 0) + (z.discountTotal || 0);
    agg.refundTotal = (agg.refundTotal || 0) + (z.refundTotal || 0);
    agg.quantity = (agg.quantity || 0) + (z.quantity || 0);
    if (!agg.id) agg.id = z.id;
  }
  return agg;
}

// Bookings for a business date. Fresto's `/bookings` endpoint returns
// individual reservations with guests count + start/end + status. If the
// endpoint isn't available for a tenant, return [] and downstream drops
// guests_booked / hourly_covers.
export async function pullBookingsForDay(entity: EntityCode, date: string): Promise<FrestoBookingLike[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    const resp = await frestoGet<{ data: FrestoBookingLike[] }>(entity, "/bookings", {
      startDate: date, endDate: date, businessDate: date, pagesize: 5000,
    });
    return resp?.data || [];
  } catch {
    return [];
  }
}

// Daily bookings summary — the source of `guests_daily` (walk-ins
// included). Not every tenant exposes this; return null on miss and
// let the caller keep guests_daily null.
export async function pullBookingsDailyForDay(entity: EntityCode, date: string): Promise<FrestoBookingsDailyLike | null> {
  if (FRESTO_DRY_RUN()) return null;
  if (!getFrestoCredentials(entity)) return null;
  try {
    const resp = await frestoGet<{ data: FrestoBookingsDailyLike[] }>(entity, "/bookings/daily", {
      startDate: date, endDate: date, businessDate: date,
    });
    const arr = resp?.data || [];
    return arr[0] || null;
  } catch {
    return null;
  }
}

// Salepoints KPI for the day — per salepoint revenue/orders/items.
export async function pullSalepointsKpiForDay(entity: EntityCode, date: string): Promise<any[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    const resp = await frestoGet<{ data: any[] }>(entity, "/sales/salepoints", {
      startDate: date, endDate: date, businessDate: date,
    });
    return resp?.data || [];
  } catch {
    return [];
  }
}

// Master pulls — refresh whole-list on demand, upsert on (entity, fresto_id).
export async function pullTablesMaster(entity: EntityCode): Promise<any[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    const resp = await frestoGet<{ data: any[] }>(entity, "/tables", { getAll: 1, pagesize: 5000 });
    return resp?.data || [];
  } catch { return []; }
}
export async function pullStaffMaster(entity: EntityCode): Promise<any[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    const resp = await frestoGet<{ data: any[] }>(entity, "/staff", { getAll: 1, pagesize: 5000 });
    return resp?.data || [];
  } catch {
    // Some tenants call it /users.
    try {
      const resp2 = await frestoGet<{ data: any[] }>(entity, "/users", { getAll: 1, pagesize: 5000 });
      return resp2?.data || [];
    } catch { return []; }
  }
}
export async function pullMenuProductsMaster(entity: EntityCode): Promise<any[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    const resp = await frestoGet<{ data: any[] }>(entity, "/menu/products", { getAll: 1, pagesize: 5000 });
    return resp?.data || [];
  } catch { return []; }
}
export async function pullMenuGroupsMaster(entity: EntityCode): Promise<any[]> {
  if (FRESTO_DRY_RUN()) return [];
  if (!getFrestoCredentials(entity)) return [];
  try {
    // Prefer `/menu/product-groups`; some tenants use `/menu/groups`.
    try {
      const resp = await frestoGet<{ data: any[] }>(entity, "/menu/product-groups", { getAll: 1, pagesize: 5000 });
      return resp?.data || [];
    } catch {
      const resp2 = await frestoGet<{ data: any[] }>(entity, "/menu/groups", { getAll: 1, pagesize: 5000 });
      return resp2?.data || [];
    }
  } catch { return []; }
}

export async function listRecentClosingReports(entity: EntityCode, sinceDate: string, untilDate?: string): Promise<FrestoZReport[]> {
  if (FRESTO_DRY_RUN()) return [];
  const creds = getFrestoCredentials(entity);
  if (!creds) return [];
  const resp = await frestoGet<{ data: FrestoZReport[] }>(entity, "/sales/z-reports", {
    startDate: sinceDate,
    endDate: untilDate || sinceDate,
  });
  return resp?.data || [];
}

// Kept for surface compatibility.
export async function pullDayCombined(entity: EntityCode, restaurant_id: string, date: string): Promise<PosDailySale | null> {
  const [day, z] = await Promise.all([pullDay(entity, restaurant_id, date), pullZReport(entity, date)]);
  if (!day && !z) return null;
  const lines: PosSaleLine[] = day?.lines || [
    { group: "food",       net_eur: 0, vat_rate: 10, vat_eur: 0 },
    { group: "wine",       net_eur: 0, vat_rate: 10, vat_eur: 0 },
    { group: "bar",        net_eur: 0, vat_rate: 21, vat_eur: 0 },
    { group: "softdrinks", net_eur: 0, vat_rate: 10, vat_eur: 0 },
    { group: "tips",       net_eur: Number(z?.tips || 0), vat_rate: 0, vat_eur: 0 },
  ];
  const total = Number(z?.revenue ?? day?.total_eur ?? 0);
  return {
    date, restaurant_id, covers: 0, lines, total_eur: total,
    source: { adapter: "fresto", raw_ref: z?.id ? `zreport:${z.id}` : `orderlines:${date}` },
  };
}

// Regex used by both the closing-report email parser and any operator
// dashboard pastes. Fresto's email body has a "Guests: N" line — a stray
// "guest:" or "guests :" is also accepted. Exports the regex so tests
// can lock the shape.
export const FRESTO_GUESTS_REGEX = /\bguests?\s*:\s*(\d+)\b/i;

export function parseGuestsFromEmailBody(body: string | null | undefined): number | null {
  if (!body) return null;
  const m = String(body).match(FRESTO_GUESTS_REGEX);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- The writer ----------
//
// Idempotent upsert on (restaurant_id, date, source='fresto'). If the row
// already exists we UPDATE all POS-derived fields but preserve any
// guests / guests_source / guests_keyed_* that Boris keyed manually — the
// audit rule is that manual key trumps API pull.

export async function persistPullToPos(params: {
  entity: EntityCode;
  restaurant_id: string;
  date: string;
  imported_by?: string | null;
}): Promise<{ id: string; existed: boolean } | null> {
  const { supabaseServer } = await import("@/lib/supabaseServer");
  const sb = supabaseServer();

  // Pull the whole day surface in parallel. Best-effort: bookings /
  // bookings_daily / salepoints may 404 on tenants that don't expose the
  // endpoint — those come back empty and downstream drops the derived
  // slot rather than fabricating a value.
  const [orderlines, orders, zRaw, bookings, bookingsDaily, salepointsKpi] = await Promise.all([
    pullOrderlinesForDay(params.entity, params.date),
    pullOrdersForDay(params.entity, params.date),
    (async (): Promise<FrestoZReport[]> => {
      if (FRESTO_DRY_RUN()) return [];
      if (!getFrestoCredentials(params.entity)) return [];
      try {
        const resp = await frestoGet<{ data: FrestoZReport[] }>(params.entity, "/sales/z-reports", { startDate: params.date, endDate: params.date });
        return resp?.data || [];
      } catch { return []; }
    })(),
    pullBookingsForDay(params.entity, params.date),
    pullBookingsDailyForDay(params.entity, params.date),
    pullSalepointsKpiForDay(params.entity, params.date),
  ]);

  if (!orderlines.length && !zRaw.length) return null;

  // Live-API pulls happen now, so resolveTradingDate returns the label
  // unchanged (pulledAt = now, which is post-fix). We still route through
  // the helper — single source per derived_date_computed_once — so a
  // backfill script feeding cached rows uses the same code path.
  const pulledAt = new Date();

  // --- Persist raw tables (best-effort; do not block the eod_pos upsert
  //     on raw-table errors — those get logged into raw_payload for the
  //     audit trail). Order matters for foreign-key-like relations but
  //     these tables have no FKs; independent writes are fine.
  const rawWriteErrors: string[] = [];
  await Promise.all([
    writeOrderlinesRaw(sb, params.entity, params.date, orderlines, pulledAt).catch((e) => rawWriteErrors.push("orderlines:" + (e?.message || e))),
    writeOrdersRaw(sb, params.entity, params.date, orders, pulledAt).catch((e) => rawWriteErrors.push("orders:" + (e?.message || e))),
    writeZReportsRaw(sb, params.entity, params.date, zRaw, pulledAt).catch((e) => rawWriteErrors.push("z:" + (e?.message || e))),
    writeBookingsRaw(sb, params.entity, params.date, bookings, pulledAt).catch((e) => rawWriteErrors.push("bookings:" + (e?.message || e))),
    writeBookingsDailyRaw(sb, params.entity, params.date, bookingsDaily, pulledAt).catch((e) => rawWriteErrors.push("bookings_daily:" + (e?.message || e))),
    writeSalepointsKpiRaw(sb, params.entity, params.date, salepointsKpi, pulledAt).catch((e) => rawWriteErrors.push("salepoints:" + (e?.message || e))),
  ]);

  // --- Derive every metric via the single helper. ---------------------
  const derived = derivePosMetrics({ orderlines, orders, zRaw, bookings, bookingsDaily });

  // VAT-heuristic revenue split remains here for the food/wine/bar/softdrinks
  // columns eod_pos already exposes. The derive helper doesn't reach into
  // those (it emits productgroup_mix); we keep the old split alongside.
  const bucket = { food: 0, wine: 0, bar: 0, softdrinks: 0 };
  for (const ol of orderlines) {
    const price = Number(ol.price || 0);
    const vat = Number(ol.vatPct || 0);
    if (vat >= 20) bucket.bar += price;
    else bucket.food += price;
  }

  const zIds = zRaw.map((z) => z.id).filter((x): x is string => !!x);
  const source_ref = zIds.length ? `zreport:${zIds.join(",")}` : `orderlines:${params.date}`;
  const raw_payload = {
    version: "derived_v2_2026-09-09",
    orderlines_count: orderlines.length,
    orders_count: derived.orders_count,
    tables_count: derived.tables_count,
    tickets: derived.tickets,
    z_spans_days: derived.z_spans_days,
    z_ids: zIds,
    bookings_count: bookings.length,
    salepoints_kpi_count: salepointsKpi.length,
    raw_write_errors: rawWriteErrors.length ? rawWriteErrors : undefined,
  };

  // Preserve manual guests key. `guests_daily` from the bookings/daily
  // endpoint lands in a separate column — we DO NOT overwrite the
  // `guests` column when guests_source='manual'.
  const found = await sb.from("eod_pos")
    .select("id, guests, guests_source, guests_keyed_by, guests_keyed_at")
    .eq("restaurant_id", params.restaurant_id)
    .eq("date", params.date)
    .eq("source", "fresto")
    .maybeSingle();

  // Compose the patch. Note: `guests` (the manual-key column) is not in
  // patch — untouched. `guests_daily`, `guests_booked`, `guests_walkins`
  // are safe to overwrite because they come from the API surface every run.
  const patch: any = {
    restaurant_id: params.restaurant_id,
    date: params.date,
    source: "fresto",
    source_ref,
    covers: null, // deprecated for fresto rows
    tickets: derived.tickets,
    orders_count: derived.orders_count,
    tables_count: derived.tables_count,
    distinct_waiters: derived.distinct_waiters,
    z_spans_days: derived.z_spans_days,
    food_net_eur: bucket.food,
    wine_net_eur: bucket.wine,
    bar_net_eur: bucket.bar,
    softdrinks_net_eur: bucket.softdrinks,
    tips_eur: derived.tips_eur,
    service_charge_eur: 0,
    cash_declared_eur: derived.cash_declared_eur,
    card_declared_eur: derived.card_declared_eur,
    total_gross_eur: derived.total_gross_eur,
    hourly_revenue: derived.hourly_revenue,
    hourly_orders: derived.hourly_orders,
    hourly_covers: derived.hourly_covers,
    payment_mix: derived.payment_mix,
    salepoint_mix: derived.salepoint_mix,
    productgroup_mix: derived.productgroup_mix,
    peak_hour: derived.peak_hour,
    peak_hour_revenue: derived.peak_hour_revenue,
    guests_daily: derived.guests_daily,
    guests_booked: derived.guests_booked,
    guests_walkins: derived.guests_walkins,
    avg_spend_per_guest: derived.avg_spend_per_guest,
    avg_ticket_size: derived.avg_ticket_size,
    turnover_ratio: derived.turnover_ratio,
    imported_by: params.imported_by || null,
    raw_payload,
  };

  if (found.data?.id) {
    const upd = await sb.from("eod_pos").update(patch).eq("id", found.data.id).select("id").single();
    if (upd.error) throw new Error("eod_pos update failed: " + upd.error.message);
    return { id: upd.data.id, existed: true };
  }

  const ins = await sb.from("eod_pos").insert({
    ...patch,
    guests: null,
    guests_source: null,
    guests_keyed_by: null,
    guests_keyed_at: null,
  }).select("id").single();
  if (ins.error) throw new Error("eod_pos insert failed: " + ins.error.message);
  return { id: ins.data.id, existed: false };
}

// ---------- Raw-table writers (best-effort, upsert-style) ----------
//
// Every writer takes the raw Fresto rows, projects a few searchable
// columns, and stores the full body in `raw jsonb`. Uniqueness lets us
// re-run any day safely. Callers wrap each in a try/catch so a single
// raw-table failure doesn't break the eod_pos derivation.

async function writeOrderlinesRaw(sb: any, entity: EntityCode, businessDate: string, rows: FrestoOrderline[], pulledAt: Date) {
  if (!rows.length) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = rows.map((r) => ({
    entity_code: entity,
    fresto_id: String(r.id || ""),
    order_id: r.orderID || null,
    business_date: businessDate,
    trading_date: trading,
    is_revenue: (r.isRevenue ?? 1) === 1,
    cancelled: (r.cancelled ?? 0) === 1,
    price_eur: Number(r.price || 0),
    quantity: Number(r.quantity || 0),
    vat_pct: r.vatPct != null ? Number(r.vatPct) : null,
    product_id: (r as any).productID || null,
    product_group_id: (r as any).productGroupID || null,
    sale_point_id: (r as any).salePointID || null,
    user_id: (r as any).userID || null,
    raw: r as any,
    pulled_at: pulledAt.toISOString(),
  })).filter((x) => x.fresto_id);
  if (!payload.length) return;
  const r = await sb.from("fresto_orderlines_raw").upsert(payload, { onConflict: "entity_code,business_date,fresto_id,order_id" });
  if (r.error) throw new Error(r.error.message);
}

async function writeOrdersRaw(sb: any, entity: EntityCode, businessDate: string, rows: FrestoOrder[], pulledAt: Date) {
  if (!rows.length) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = rows.map((r) => ({
    entity_code: entity,
    fresto_id: String(r.id || ""),
    business_date: businessDate,
    trading_date: trading,
    table_id: (r as any).tableID || null,
    order_slug: (r as any).slug || null,
    cancelled: (r.cancelled ?? 0) === 1,
    revenue_eur: Number((r as any).revenue || 0),
    quantity_items: Number((r as any).quantity || 0),
    raw: r as any,
    pulled_at: pulledAt.toISOString(),
  })).filter((x) => x.fresto_id);
  if (!payload.length) return;
  const r = await sb.from("fresto_orders_raw").upsert(payload, { onConflict: "entity_code,business_date,fresto_id" });
  if (r.error) throw new Error(r.error.message);
}

async function writeZReportsRaw(sb: any, entity: EntityCode, businessDate: string, rows: FrestoZReport[], pulledAt: Date) {
  if (!rows.length) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = rows.map((r) => {
    const from = _isoDatePart((r as any).fromDate);
    const to = _isoDatePart((r as any).toDate);
    return {
      entity_code: entity,
      fresto_id: String(r.id || ""),
      from_date: (r as any).fromDate || null,
      to_date: (r as any).toDate || null,
      business_date: from || businessDate,
      trading_date: trading,
      spans_days: !!(from && to && from !== to),
      revenue_eur: Number((r as any).revenue || 0),
      cash_revenue_eur: Number((r as any).cashRevenue || 0),
      cards_total_eur: Number((r as any).cardsTotal || 0),
      online_cards_total_eur: Number((r as any).onlineCardsTotal || 0),
      tips_eur: Number((r as any).tips || 0),
      vat_amount_eur: Number((r as any).vatAmount || 0),
      quantity: Number((r as any).quantity || 0),
      raw: r as any,
      pulled_at: pulledAt.toISOString(),
    };
  }).filter((x) => x.fresto_id);
  if (!payload.length) return;
  const r = await sb.from("fresto_z_reports_raw").upsert(payload, { onConflict: "entity_code,fresto_id" });
  if (r.error) throw new Error(r.error.message);
}

async function writeBookingsRaw(sb: any, entity: EntityCode, businessDate: string, rows: FrestoBookingLike[], pulledAt: Date) {
  if (!rows.length) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = rows.map((r) => ({
    entity_code: entity,
    fresto_id: String(r.id || ""),
    business_date: businessDate,
    trading_date: trading,
    guests: Number(r.guests || 0) || null,
    status: r.status || null,
    booking_ts: r.fromDate || null,
    table_id: (r as any).tableID || null,
    raw: r as any,
    pulled_at: pulledAt.toISOString(),
  })).filter((x) => x.fresto_id);
  if (!payload.length) return;
  const r = await sb.from("fresto_bookings_raw").upsert(payload, { onConflict: "entity_code,fresto_id" });
  if (r.error) throw new Error(r.error.message);
}

async function writeBookingsDailyRaw(sb: any, entity: EntityCode, businessDate: string, row: FrestoBookingsDailyLike | null, pulledAt: Date) {
  if (!row) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = {
    entity_code: entity,
    business_date: businessDate,
    trading_date: trading,
    guests_daily: Number(row.guests || 0) || null,
    raw: row as any,
    pulled_at: pulledAt.toISOString(),
  };
  const r = await sb.from("fresto_bookings_daily_raw").upsert(payload, { onConflict: "entity_code,business_date" });
  if (r.error) throw new Error(r.error.message);
}

async function writeSalepointsKpiRaw(sb: any, entity: EntityCode, businessDate: string, rows: any[], pulledAt: Date) {
  if (!rows.length) return;
  const trading = resolveTradingDate(pulledAt, businessDate);
  const payload = rows.map((r) => ({
    entity_code: entity,
    business_date: businessDate,
    trading_date: trading,
    sale_point_id: String(r.salePointID || r.id || ""),
    sale_point_name: r.name || null,
    revenue_eur: Number(r.revenue || 0),
    orders: Number(r.orders || 0) || null,
    items: Number(r.quantity || r.items || 0) || null,
    raw: r as any,
    pulled_at: pulledAt.toISOString(),
  })).filter((x) => x.sale_point_id);
  if (!payload.length) return;
  const r = await sb.from("fresto_salepoints_kpi_raw").upsert(payload, { onConflict: "entity_code,business_date,sale_point_id" });
  if (r.error) throw new Error(r.error.message);
}

// Master-table refresh — call from the nightly cron once per venue (not per day).
export async function refreshFrestoMasters(entity: EntityCode): Promise<{ tables: number; staff: number; products: number; groups: number }> {
  const { supabaseServer } = await import("@/lib/supabaseServer");
  const sb = supabaseServer();
  const pulledAt = new Date();
  const [tables, staff, products, groups] = await Promise.all([
    pullTablesMaster(entity),
    pullStaffMaster(entity),
    pullMenuProductsMaster(entity),
    pullMenuGroupsMaster(entity),
  ]);

  if (tables.length) {
    await sb.from("fresto_tables_master").upsert(tables.map((t: any) => ({
      entity_code: entity, fresto_id: String(t.id || ""),
      name: t.name || null, capacity: Number(t.capacity || 0) || null,
      sale_point_id: t.salePointID || null,
      raw: t as any, pulled_at: pulledAt.toISOString(),
    })).filter((x) => x.fresto_id), { onConflict: "entity_code,fresto_id" });
  }
  if (staff.length) {
    await sb.from("fresto_staff_master").upsert(staff.map((s: any) => ({
      entity_code: entity, fresto_id: String(s.id || ""),
      name: s.name || s.displayName || null, role: s.role || null,
      active: s.active != null ? !!s.active : null,
      raw: s as any, pulled_at: pulledAt.toISOString(),
    })).filter((x) => x.fresto_id), { onConflict: "entity_code,fresto_id" });
  }
  if (products.length) {
    await sb.from("fresto_menu_products_master").upsert(products.map((p: any) => ({
      entity_code: entity, fresto_id: String(p.id || ""),
      name: p.name || p.title || null,
      product_group_id: p.productGroupID || null,
      price_eur: Number(p.price || 0) || null,
      cost_eur: Number(p.cost || 0) || null,
      vat_pct: p.vatPct != null ? Number(p.vatPct) : null,
      accounting_code: p.productAccountingCode || null,
      active: p.active != null ? !!p.active : null,
      raw: p as any, pulled_at: pulledAt.toISOString(),
    })).filter((x) => x.fresto_id), { onConflict: "entity_code,fresto_id" });
  }
  if (groups.length) {
    await sb.from("fresto_menu_groups_master").upsert(groups.map((g: any) => ({
      entity_code: entity, fresto_id: String(g.id || ""),
      name: g.name || null,
      parent_group_id: g.parentID || g.parentGroupID || null,
      raw: g as any, pulled_at: pulledAt.toISOString(),
    })).filter((x) => x.fresto_id), { onConflict: "entity_code,fresto_id" });
  }

  return { tables: tables.length, staff: staff.length, products: products.length, groups: groups.length };
}

// ---------- Adapter surface (kept API-compatible with the existing registry) ----------

export const frestoAdapter: PosAdapter = {
  name: "Fresto",
  vendor: "fresto",
  async parseUpload(buf: ArrayBuffer): Promise<PosDailySale[]> {
    const rows = parseFrestoXlsx(buf);
    return rows.map((r) => ({
      date: r.date,
      restaurant_id: "",
      covers: r.covers,
      lines: [
        { group: "food", net_eur: r.food, vat_rate: 10, vat_eur: r.food * 0.10 },
        { group: "wine", net_eur: r.wine, vat_rate: 10, vat_eur: r.wine * 0.10 },
        { group: "bar",  net_eur: r.bar,  vat_rate: 10, vat_eur: r.bar  * 0.10 },
        { group: "softdrinks", net_eur: r.softdrinks, vat_rate: 10, vat_eur: r.softdrinks * 0.10 },
        { group: "tips", net_eur: r.tips, vat_rate: 0, vat_eur: 0 },
      ],
      total_eur: r.total,
      source: { adapter: "fresto" },
    }));
  },
  async pullDay(restaurant_id: string, date: string): Promise<PosDailySale | null> {
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const sb = supabaseServer();
    const { data } = await sb.from("eod_pos")
      .select("food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur,covers,guests,tickets")
      .eq("restaurant_id", restaurant_id)
      .eq("date", date)
      .eq("source", "fresto")
      .maybeSingle();
    if (!data) return null;
    const lines: PosSaleLine[] = [
      { group: "food",       net_eur: Number(data.food_net_eur       || 0), vat_rate: 10, vat_eur: Number(data.food_net_eur       || 0) * 0.10 },
      { group: "wine",       net_eur: Number(data.wine_net_eur       || 0), vat_rate: 10, vat_eur: Number(data.wine_net_eur       || 0) * 0.10 },
      { group: "bar",        net_eur: Number(data.bar_net_eur        || 0), vat_rate: 10, vat_eur: Number(data.bar_net_eur        || 0) * 0.10 },
      { group: "softdrinks", net_eur: Number(data.softdrinks_net_eur || 0), vat_rate: 10, vat_eur: Number(data.softdrinks_net_eur || 0) * 0.10 },
      { group: "tips",       net_eur: Number(data.tips_eur           || 0), vat_rate: 0,  vat_eur: 0 },
    ];
    // covers on the PosDailySale surface is now guest-count, falling back
    // to null (rendered as 0 by legacy consumers). tickets is not part of
    // the PosDailySale shape — a follow-up will thread it through.
    return {
      date,
      restaurant_id,
      covers: Number(data.guests ?? data.covers ?? 0),
      lines,
      total_eur: Number(data.total_gross_eur || 0),
      source: { adapter: "fresto", raw_ref: "eod_pos" },
    };
  },
};
