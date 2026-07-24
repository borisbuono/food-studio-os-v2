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

// Persist a parsed Fresto row to eod_pos (immutable POS snapshot). Idempotent per
// (restaurant_id, date, source). Used by both the XLSX upload path and the live API pull.
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
    covers: row.covers || 0,
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

// Pull all orderlines for a date and aggregate into a canonical PosDailySale.
// Group buckets are inferred from the productGroupID (best-effort) since Fresto does
// not tag "food/wine/bar/softdrinks" natively — we use vatPct + accounting code hints
// and fall back to "other". Downstream (eod_pos) accepts the split; anything unmatched
// lands under food so total_gross_eur reconciles.
export async function pullDay(entity: EntityCode, restaurant_id: string, date: string): Promise<PosDailySale | null> {
  if (FRESTO_DRY_RUN()) {
    // Dry-run: emit an empty shell so the surface can still render "0 pulled" without hitting the API.
    return {
      date, restaurant_id, covers: 0, lines: [], total_eur: 0,
      source: { adapter: "fresto", raw_ref: "dry-run" },
    };
  }
  const creds = getFrestoCredentials(entity);
  if (!creds) return null;

  // Fresto uses startDate/endDate (inclusive). One day = same value.
  const resp = await frestoGet<{ data: FrestoOrderline[] }>(entity, "/sales/orderlines", { startDate: date, endDate: date, pagesize: 5000 });
  const lines = (resp?.data || []).filter((l) => (l.isRevenue ?? 1) === 1 && (l.cancelled ?? 0) === 0);

  // Bucket orderlines. Fresto's group naming is per-tenant so we infer:
  //  - group name from menu/product-groups if the title is available in the line's slug
  //  - fall back to bar/food from isBarProduct / vatPct heuristics
  // Since /sales/orderlines does not embed product-group titles, we key by productGroupID
  // and treat unknown groups as food. Wine/softdrinks discovery lives in a follow-up
  // migration that seeds a productGroupID → bucket map per venue.
  const bucket = { food: 0, wine: 0, bar: 0, softdrinks: 0, tips: 0 };
  let total = 0;
  for (const ol of lines) {
    const price = Number(ol.price || 0);
    total += price;
    // Very rough heuristic. VAT 21% in Spain is usually alcohol; 10% is food. Real
    // classification happens in a future productGroupID map; today Boris still
    // trusts the ZReport for the split (see pullZReport below).
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

// Pull the closing (Z) report for a date. Fresto Z reports are the authoritative
// end-of-day figures — cash / cards / tips / discounts — and are what Boris books.
export async function pullZReport(entity: EntityCode, date: string): Promise<FrestoZReport | null> {
  if (FRESTO_DRY_RUN()) return null;
  const creds = getFrestoCredentials(entity);
  if (!creds) return null;
  const resp = await frestoGet<{ data: FrestoZReport[] }>(entity, "/sales/z-reports", { startDate: date, endDate: date });
  const arr = resp?.data || [];
  if (!arr.length) return null;
  // Multiple Z-reports possible if there were multiple closings — aggregate them.
  const agg: FrestoZReport = { fromDate: date, toDate: date, revenue: 0, cashRevenue: 0, cardsTotal: 0, tips: 0, vatAmount: 0, discountTotal: 0, refundTotal: 0 };
  for (const z of arr) {
    agg.revenue = (agg.revenue || 0) + (z.revenue || 0);
    agg.cashRevenue = (agg.cashRevenue || 0) + (z.cashRevenue || 0);
    agg.cardsTotal = (agg.cardsTotal || 0) + (z.cardsTotal || 0);
    agg.tips = (agg.tips || 0) + (z.tips || 0);
    agg.vatAmount = (agg.vatAmount || 0) + (z.vatAmount || 0);
    agg.discountTotal = (agg.discountTotal || 0) + (z.discountTotal || 0);
    agg.refundTotal = (agg.refundTotal || 0) + (z.refundTotal || 0);
    // preserve id of the first for reference
    if (!agg.id) agg.id = z.id;
  }
  return agg;
}

// List Z reports for backfill / catchup — used by /sync and by the closing-report webhook
// receiver when the payload contains an ID but not the full body.
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

// Combine an orderlines pull + Z Report into the canonical PosDailySale shape we persist
// to eod_pos. Z Report wins for cash/card/tips totals — orderlines contribute the
// product-group split. If the Z Report is missing we surface orderlines only.
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
  // Prefer Z Report revenue as the authoritative daily total.
  const total = Number(z?.revenue ?? day?.total_eur ?? 0);
  return {
    date,
    restaurant_id,
    covers: day?.covers || 0,
    lines,
    total_eur: total,
    source: { adapter: "fresto", raw_ref: z?.id ? `zreport:${z.id}` : `orderlines:${date}` },
  };
}

// Persist a live pull to eod_pos. Handles the ZReport → cash/card split so downstream
// house-rule (deduct cash from food) still fires.
export async function persistPullToPos(params: {
  entity: EntityCode;
  restaurant_id: string;
  date: string;
  imported_by?: string | null;
}): Promise<{ id: string; existed: boolean } | null> {
  const combined = await pullDayCombined(params.entity, params.restaurant_id, params.date);
  if (!combined) return null;
  const z = await pullZReport(params.entity, params.date);
  const row = {
    date: params.date,
    covers: combined.covers || 0,
    food: combined.lines.find((l) => l.group === "food")?.net_eur || 0,
    wine: combined.lines.find((l) => l.group === "wine")?.net_eur || 0,
    bar:  combined.lines.find((l) => l.group === "bar")?.net_eur  || 0,
    softdrinks: combined.lines.find((l) => l.group === "softdrinks")?.net_eur || 0,
    tips: Number(z?.tips || combined.lines.find((l) => l.group === "tips")?.net_eur || 0),
    total: combined.total_eur || 0,
    cash: Number(z?.cashRevenue || 0),
    card: Number((z?.cardsTotal || 0) + (z?.onlineCardsTotal || 0)),
  };
  return await persistFrestoRowToPos({
    restaurant_id: params.restaurant_id,
    row,
    source_ref: combined.source.raw_ref || `fresto-api:${params.date}`,
    imported_by: params.imported_by || null,
    raw_payload: { orderlines_summary: combined, zreport: z },
  });
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
    // Legacy read path — read the immutable snapshot for the day. Live pulls happen via
    // the /api/integrations/fresto/sync route (which uses pullDayCombined + persistPullToPos).
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const sb = supabaseServer();
    const { data } = await sb.from("eod_pos")
      .select("food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur,covers")
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
    return {
      date,
      restaurant_id,
      covers: Number(data.covers || 0),
      lines,
      total_eur: Number(data.total_gross_eur || 0),
      source: { adapter: "fresto", raw_ref: "eod_pos" },
    };
  },
};
