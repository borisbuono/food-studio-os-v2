import * as XLSX from "xlsx";
import type { PosAdapter, PosDailySale, PosSaleLine, EntityCode } from "@/lib/integrations/types";

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

// Extract "YYYY-MM-DD" from an ISO-ish string. Fresto returns things like
// "2026-08-30T03:14:22Z" for z.fromDate/toDate. If the string is missing
// or malformed we return null.
function isoDatePart(s: string | undefined | null): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

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

  const [orderlines, orders, zRaw] = await Promise.all([
    pullOrderlinesForDay(params.entity, params.date),
    pullOrdersForDay(params.entity, params.date),
    // Raw z-report list (not aggregated) — we need per-z fromDate/toDate
    // to detect multi-day z's.
    (async (): Promise<FrestoZReport[]> => {
      if (FRESTO_DRY_RUN()) return [];
      if (!getFrestoCredentials(params.entity)) return [];
      try {
        const resp = await frestoGet<{ data: FrestoZReport[] }>(params.entity, "/sales/z-reports", { startDate: params.date, endDate: params.date });
        return resp?.data || [];
      } catch {
        return [];
      }
    })(),
  ]);

  if (!orderlines.length && !zRaw.length) return null;

  // --- Tickets / orders_count / tables_count from orderlines + orders. --
  // Orderlines are already filtered (isRevenue=1, cancelled=0) so quantity
  // sums are the item count you'd see on the ticket. Fresto tolerates
  // fractional quantity for weight-based items (charcuterie, cheese) but
  // rounding to whole items matches operator instinct.
  const tickets = Math.round(orderlines.reduce((s, l) => s + Number(l.quantity || 0), 0));
  const orderIds = new Set<string>();
  for (const l of orderlines) if (l.orderID) orderIds.add(l.orderID);
  const orders_count = orderIds.size || null;
  const tableIds = new Set<string>();
  for (const o of orders) if (o.tableID) tableIds.add(o.tableID);
  const tables_count = tableIds.size || null;

  // --- Revenue split from orderlines. VAT heuristic (>=20 → bar, else
  // food) is deliberately conservative — the product-group map lives in a
  // follow-up migration; today the aggregate total_gross_eur is what
  // Boris trusts. See notes at top of file. ---
  const bucket = { food: 0, wine: 0, bar: 0, softdrinks: 0 };
  for (const ol of orderlines) {
    const price = Number(ol.price || 0);
    const vat = Number(ol.vatPct || 0);
    if (vat >= 20) bucket.bar += price;
    else bucket.food += price;
  }

  // --- Z-report aggregation + multi-day detection. ---------------------
  // z_spans_days is true if ANY z touching this date has fromDate.date
  // != toDate.date. When that happens cash/card/tips reflect the SPAN,
  // not the day — we null them so downstream doesn't book fake cash.
  let z_spans_days = false;
  let cashRevenue = 0, cardsTotal = 0, onlineCardsTotal = 0, tips = 0, zRevenue = 0;
  const zIds: string[] = [];
  for (const z of zRaw) {
    if (z.id) zIds.push(z.id);
    const from = isoDatePart(z.fromDate);
    const to = isoDatePart(z.toDate);
    if (from && to && from !== to) z_spans_days = true;
    cashRevenue += Number(z.cashRevenue || 0);
    cardsTotal += Number(z.cardsTotal || 0);
    onlineCardsTotal += Number(z.onlineCardsTotal || 0);
    tips += Number(z.tips || 0);
    zRevenue += Number(z.revenue || 0);
  }

  // total_gross_eur — prefer the sum of z.revenue as the authoritative
  // daily total, fall back to orderlines aggregate if z's are missing.
  const orderlinesTotal = orderlines.reduce((s, l) => s + Number(l.price || 0), 0);
  const total_gross = zRevenue || orderlinesTotal;

  // Cash/card/tips: null when the z that dropped on this day covered a
  // multi-day span (unsafe to attribute).
  const cash_declared_eur = z_spans_days ? null : (cashRevenue || 0);
  const card_declared_eur = z_spans_days ? null : ((cardsTotal || 0) + (onlineCardsTotal || 0));
  const tips_eur = z_spans_days ? null : (tips || 0);

  // --- Upsert -----------------------------------------------------------
  const source_ref = zIds.length ? `zreport:${zIds.join(",")}` : `orderlines:${params.date}`;
  const raw_payload = {
    version: "tickets_guests_v1",
    orderlines_count: orderlines.length,
    orders_count,
    tables_count,
    tickets,
    z_spans_days,
    z_ids: zIds,
    // Keep the aggregated z summary for auditability without dumping the
    // full body (a busy day can have 20 z-reports).
    zreport_summary: {
      revenue: zRevenue, cashRevenue, cardsTotal, onlineCardsTotal, tips,
      count: zRaw.length,
    },
  };

  // Insert or update in one round-trip. We select first to preserve the
  // manual guests key if present (never overwrite guests_source='manual').
  const found = await sb.from("eod_pos")
    .select("id, guests, guests_source, guests_keyed_by, guests_keyed_at")
    .eq("restaurant_id", params.restaurant_id)
    .eq("date", params.date)
    .eq("source", "fresto")
    .maybeSingle();

  const patch: any = {
    restaurant_id: params.restaurant_id,
    date: params.date,
    source: "fresto",
    source_ref,
    covers: null, // deprecated for fresto rows
    tickets,
    orders_count,
    tables_count,
    z_spans_days,
    food_net_eur: bucket.food,
    wine_net_eur: bucket.wine,
    bar_net_eur: bucket.bar,
    softdrinks_net_eur: bucket.softdrinks,
    tips_eur: tips_eur == null ? null : tips_eur,
    service_charge_eur: 0,
    cash_declared_eur,
    card_declared_eur,
    total_gross_eur: total_gross,
    imported_by: params.imported_by || null,
    raw_payload,
  };

  // Preserve manual guests key (audit rule). If email or import already
  // set guests we still keep them — the writer never touches guests.
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
