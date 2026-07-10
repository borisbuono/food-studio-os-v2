// Finance intelligence #1 — anomaly detector.
//
// Nine detectors, each pure: reads one or two finance tables and returns an
// array of candidate anomaly rows. `detectAll(entity_code)` runs them
// concurrently and upserts to `finance_anomalies`. Idempotent — each
// candidate has a stable meta_hash so re-running just refreshes
// last_seen_date on the same row.
//
// Kinds:
//   1. eod_cash_ratio_high         (kitchen — surfaces to /execute/pass/metrics)
//   2. eod_no_source
//   3. bank_movement_unmatched_long
//   4. invoice_missing_supplier
//   5. invoice_amount_outlier
//   6. duplicate_asiento
//   7. posting_before_bank
//   8. vat_ratio_deviation
//   9. intercompany_ghost
//
// Every scan writes an assistant_actions row (action_kind='anomaly_scan') so
// nightly runs, on-demand runs, and FAB-triggered runs are all auditable.

import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";

export type EntityCode = "IFL" | "BM" | "BBH";

export type AnomalyKind =
  | "eod_cash_ratio_high"
  | "eod_no_source"
  | "bank_movement_unmatched_long"
  | "invoice_missing_supplier"
  | "invoice_amount_outlier"
  | "duplicate_asiento"
  | "posting_before_bank"
  | "vat_ratio_deviation"
  | "intercompany_ghost";

export type AnomalyCandidate = {
  entity_code: EntityCode;
  kind: AnomalyKind;
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  meta: Record<string, any>;
  source_table?: string | null;
  source_id?: string | null;
  first_seen_date?: string; // YYYY-MM-DD; defaults to today server-side
};

const ENTITY_TO_RID: Record<EntityCode, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  BBH: "",
};

const CASH_RATIO_THRESHOLD = 0.15;           // > 15 % cash on the day
const UNMATCHED_BANK_DAYS  = 14;
const AMOUNT_OUTLIER_SIGMA = 3.0;
const VAT_LOW  = 0.06;                       // 6 %
const VAT_HIGH = 0.14;                       // 14 %  (IFL flat 10 % target ± band)
const INTERCOMPANY_MIN_EUR = 300;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(d: number): string {
  const t = new Date(Date.now() - d * 86_400_000);
  return t.toISOString().slice(0, 10);
}
function hashMeta(entity: EntityCode, kind: AnomalyKind, meta: Record<string, any>): string {
  // Stable hash across runs — anomaly "identity" is a small tuple of the
  // source ids / dates the detector picked, NOT the whole meta blob (which
  // may include drifting values like counts). Detectors set meta._key when
  // they need a specific key; otherwise we sort-serialise the whole meta.
  const key = meta && typeof meta._key === "string" && meta._key
    ? meta._key
    : JSON.stringify(sortRecursively(meta));
  return createHash("sha1").update(entity + "|" + kind + "|" + key).digest("hex").slice(0, 32);
}
function sortRecursively(v: any): any {
  if (Array.isArray(v)) return v.map(sortRecursively);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc: any, k) => {
      if (k.startsWith("_")) return acc;
      acc[k] = sortRecursively(v[k]);
      return acc;
    }, {});
  }
  return v;
}
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = mean(nums.map((n) => (n - m) ** 2));
  return Math.sqrt(v);
}

// --------------------------------------------------------------------------
// Detector 1 — EOD cash ratio abnormally high
// --------------------------------------------------------------------------
export async function detectEodCashRatioHigh(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const rid = ENTITY_TO_RID[entity];
  if (!rid) return [];
  const sb = supabaseServer();
  const since = daysAgoISO(30);
  const { data } = await sb.from("eod_pos")
    .select("id,date,cash_declared_eur,total_gross_eur")
    .eq("restaurant_id", rid)
    .gte("date", since);
  const rows = (data || []) as Array<{ id: string; date: string; cash_declared_eur: number; total_gross_eur: number }>;
  const out: AnomalyCandidate[] = [];
  for (const r of rows) {
    const gross = Number(r.total_gross_eur || 0);
    const cash  = Number(r.cash_declared_eur || 0);
    if (gross <= 0) continue;
    const ratio = cash / gross;
    if (ratio <= CASH_RATIO_THRESHOLD) continue;
    out.push({
      entity_code: entity,
      kind: "eod_cash_ratio_high",
      description: "Cash was " + (ratio * 100).toFixed(1) + "% of gross on " + r.date + " (threshold 15%).",
      severity: ratio > 0.25 ? 4 : 3,
      meta: { _key: "eod:" + r.date, date: r.date, cash_eur: cash, gross_eur: gross, ratio_pct: +(ratio * 100).toFixed(2) },
      source_table: "eod_pos",
      source_id: r.id,
      first_seen_date: r.date,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Detector 2 — EOD posted without a POS source row
// --------------------------------------------------------------------------
export async function detectEodNoSource(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const rid = ENTITY_TO_RID[entity];
  if (!rid) return [];
  const sb = supabaseServer();
  const since = daysAgoISO(60);
  const { data } = await sb.from("eod_accounting")
    .select("id,report_date,revenue,eod_pos_id")
    .eq("restaurant_id", rid)
    .gte("report_date", since)
    .is("eod_pos_id", null);
  const rows = (data || []) as Array<{ id: string; report_date: string; revenue: number; eod_pos_id: string | null }>;
  return rows.map((r) => ({
    entity_code: entity,
    kind: "eod_no_source" as AnomalyKind,
    description: "Accounting EOD posted for " + r.report_date + " (€" + Math.round(Number(r.revenue || 0)) + ") without a linked POS snapshot.",
    severity: 2 as const,
    meta: { _key: "acct:" + r.id, date: r.report_date, revenue_eur: Number(r.revenue || 0) },
    source_table: "eod_accounting",
    source_id: r.id,
    first_seen_date: r.report_date,
  }));
}

// --------------------------------------------------------------------------
// Detector 3 — bank movements unmatched > N days
// --------------------------------------------------------------------------
export async function detectBankUnmatchedLong(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const cutoff = daysAgoISO(UNMATCHED_BANK_DAYS);
  const { data } = await sb.from("bank_movements")
    .select("id,amount_eur,description,movement_date,reconciled_to")
    .eq("entity_id", entity)
    .eq("reconciled_to", "unmatched")
    .lt("movement_date", cutoff);
  const rows = (data || []) as Array<{ id: string; amount_eur: number; description: string | null; movement_date: string }>;
  return rows.map((r) => ({
    entity_code: entity,
    kind: "bank_movement_unmatched_long" as AnomalyKind,
    description: (r.description || "Bank movement")
      + " · €" + Math.abs(Number(r.amount_eur || 0)).toFixed(2)
      + " unmatched since " + r.movement_date + ".",
    severity: (Math.abs(Number(r.amount_eur || 0)) > 1000 ? 4 : 3) as 3 | 4,
    meta: { _key: "bank:" + r.id, amount_eur: Number(r.amount_eur || 0), movement_date: r.movement_date, description: (r.description || "").slice(0, 200) },
    source_table: "bank_movements",
    source_id: r.id,
    first_seen_date: r.movement_date,
  }));
}

// --------------------------------------------------------------------------
// Detector 4 — invoice without a supplier link
// --------------------------------------------------------------------------
export async function detectInvoiceMissingSupplier(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const since = daysAgoISO(90);
  const { data } = await sb.from("invoice_inbox")
    .select("id,amount_eur,arrived_at,provider_id,match_status,flagged_reason")
    .eq("entity_id", entity)
    .is("provider_id", null)
    .gte("arrived_at", since + "T00:00:00");
  const rows = (data || []) as Array<{ id: string; amount_eur: number; arrived_at: string; provider_id: string | null; match_status: string; flagged_reason: string | null }>;
  return rows
    .filter((r) => !["approved", "rejected", "duplicate"].includes(String(r.match_status || "")))
    .map((r) => ({
      entity_code: entity,
      kind: "invoice_missing_supplier" as AnomalyKind,
      description: "Invoice €" + Math.round(Number(r.amount_eur || 0)) + " arrived " + r.arrived_at.slice(0, 10) + " with no supplier attached.",
      severity: (Number(r.amount_eur || 0) > 500 ? 3 : 2) as 2 | 3,
      meta: { _key: "inv:" + r.id, amount_eur: Number(r.amount_eur || 0), arrived_at: r.arrived_at },
      source_table: "invoice_inbox",
      source_id: r.id,
      first_seen_date: r.arrived_at.slice(0, 10),
    }));
}

// --------------------------------------------------------------------------
// Detector 5 — invoice amount is an outlier vs. the supplier's rolling avg
// --------------------------------------------------------------------------
export async function detectInvoiceAmountOutlier(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const since = daysAgoISO(180);
  const { data } = await sb.from("invoice_inbox")
    .select("id,amount_eur,arrived_at,provider_id,match_status")
    .eq("entity_id", entity)
    .not("provider_id", "is", null)
    .gte("arrived_at", since + "T00:00:00");
  const rows = (data || []) as Array<{ id: string; amount_eur: number; arrived_at: string; provider_id: string; match_status: string }>;
  const bySupplier = new Map<string, Array<{ id: string; amount: number; arrived_at: string }>>();
  for (const r of rows) {
    if (!bySupplier.has(r.provider_id)) bySupplier.set(r.provider_id, []);
    bySupplier.get(r.provider_id)!.push({ id: r.id, amount: Number(r.amount_eur || 0), arrived_at: r.arrived_at });
  }
  const out: AnomalyCandidate[] = [];
  for (const [pid, arr] of bySupplier) {
    if (arr.length < 5) continue;
    const amounts = arr.map((x) => x.amount);
    const m = mean(amounts);
    const s = stddev(amounts);
    if (s <= 0) continue;
    for (const r of arr) {
      const z = (r.amount - m) / s;
      if (Math.abs(z) < AMOUNT_OUTLIER_SIGMA) continue;
      out.push({
        entity_code: entity,
        kind: "invoice_amount_outlier",
        description: "Supplier invoice €" + Math.round(r.amount) + " is " + z.toFixed(1) + "σ from their rolling avg (€" + Math.round(m) + ").",
        severity: (Math.abs(z) > 4 ? 4 : 3) as 3 | 4,
        meta: { _key: "invout:" + r.id, provider_id: pid, amount_eur: r.amount, mean_eur: +m.toFixed(2), stddev_eur: +s.toFixed(2), z_score: +z.toFixed(2) },
        source_table: "invoice_inbox",
        source_id: r.id,
        first_seen_date: r.arrived_at.slice(0, 10),
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Detector 6 — duplicate asientos in bank_movements
// (Same amount + same day + same |description| landing twice on the ledger.)
// --------------------------------------------------------------------------
export async function detectDuplicateAsiento(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const since = daysAgoISO(90);
  const { data } = await sb.from("bank_movements")
    .select("id,amount_eur,description,movement_date")
    .eq("entity_id", entity)
    .gte("movement_date", since);
  const rows = (data || []) as Array<{ id: string; amount_eur: number; description: string | null; movement_date: string }>;
  const buckets = new Map<string, string[]>();
  for (const r of rows) {
    const desc = (r.description || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    const key = r.movement_date + "|" + Number(r.amount_eur || 0).toFixed(2) + "|" + desc;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r.id);
  }
  const out: AnomalyCandidate[] = [];
  for (const [key, ids] of buckets) {
    if (ids.length < 2) continue;
    const [date, amount, desc] = key.split("|");
    out.push({
      entity_code: entity,
      kind: "duplicate_asiento",
      description: "Same amount (€" + amount + ") and description hit the ledger " + ids.length + "× on " + date + ".",
      severity: 4,
      meta: { _key: "dup:" + key, ids, date, amount_eur: Number(amount), description: desc },
      source_table: "bank_movements",
      source_id: ids[0],
      first_seen_date: date,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Detector 7 — accounting posted BEFORE the bank movement
// (invoice_inbox.triaged_at earlier than the matched bank movement date —
// suggests the invoice was posted first and reconciled later, backwards.)
// --------------------------------------------------------------------------
export async function detectPostingBeforeBank(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const since = daysAgoISO(90);
  // Pull invoices approved recently and paired bank movements.
  const [invRes, bankRes] = await Promise.all([
    sb.from("invoice_inbox")
      .select("id,triaged_at,amount_eur,match_status,linked_order_id,linked_albaran_id,arrived_at")
      .eq("entity_id", entity)
      .eq("match_status", "approved")
      .not("triaged_at", "is", null)
      .gte("arrived_at", since + "T00:00:00"),
    sb.from("bank_movements")
      .select("id,amount_eur,movement_date,reconciled_to,reconciled_to_id")
      .eq("entity_id", entity)
      .eq("reconciled_to", "invoice")
      .gte("movement_date", since),
  ]);
  const invRows = (invRes.data || []) as Array<{ id: string; triaged_at: string; amount_eur: number; arrived_at: string }>;
  const bankRows = (bankRes.data || []) as Array<{ id: string; amount_eur: number; movement_date: string; reconciled_to_id: string | null }>;
  const bankByInv = new Map<string, { id: string; movement_date: string }>();
  for (const b of bankRows) {
    if (b.reconciled_to_id) bankByInv.set(String(b.reconciled_to_id), { id: b.id, movement_date: b.movement_date });
  }
  const out: AnomalyCandidate[] = [];
  for (const inv of invRows) {
    const b = bankByInv.get(inv.id);
    if (!b) continue;
    const triagedDate = inv.triaged_at.slice(0, 10);
    if (triagedDate <= b.movement_date) continue;
    out.push({
      entity_code: entity,
      kind: "posting_before_bank",
      description: "Invoice posted " + triagedDate + " but bank hit " + b.movement_date + " — order looks reversed.",
      severity: 2,
      meta: { _key: "pbb:" + inv.id, invoice_id: inv.id, bank_id: b.id, posted_at: triagedDate, banked_at: b.movement_date, amount_eur: Number(inv.amount_eur || 0) },
      source_table: "invoice_inbox",
      source_id: inv.id,
      first_seen_date: triagedDate,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Detector 8 — VAT / revenue ratio outside the expected band
// (Aggregates eod_accounting.revenue + invoice_inbox.vat_eur for the month.)
// --------------------------------------------------------------------------
export async function detectVatRatioDeviation(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const rid = ENTITY_TO_RID[entity];
  if (!rid) return [];
  const sb = supabaseServer();
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const [revRes, vatRes] = await Promise.all([
    sb.from("eod_accounting").select("revenue,report_date").eq("restaurant_id", rid).gte("report_date", monthStart),
    sb.from("invoice_inbox").select("vat_eur,arrived_at").eq("entity_id", entity).gte("arrived_at", monthStart + "T00:00:00"),
  ]);
  const revRows = (revRes.data || []) as Array<{ revenue: number }>;
  const vatRows = (vatRes.data || []) as Array<{ vat_eur: number }>;
  const revenue = revRows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const vat     = vatRows.reduce((a, r) => a + Number(r.vat_eur || 0), 0);
  if (revenue < 1000) return []; // not enough signal yet this month
  const ratio = vat / revenue;
  if (ratio >= VAT_LOW && ratio <= VAT_HIGH) return [];
  return [{
    entity_code: entity,
    kind: "vat_ratio_deviation" as AnomalyKind,
    description: "MTD VAT / revenue is " + (ratio * 100).toFixed(1) + "% — expected 6–14%.",
    severity: 3 as const,
    meta: { _key: "vat:" + monthStart.slice(0, 7), month: monthStart.slice(0, 7), revenue_eur: +revenue.toFixed(2), vat_eur: +vat.toFixed(2), ratio_pct: +(ratio * 100).toFixed(2) },
    source_table: "eod_accounting",
    source_id: null,
    first_seen_date: todayISO(),
  }];
}

// --------------------------------------------------------------------------
// Detector 9 — intercompany ghost
// (bank_movements marked reconciled_to='intercompany' without a mirror row
// on the counterpart entity — the classic BBH↔IFL/BM lending pattern.)
// --------------------------------------------------------------------------
export async function detectIntercompanyGhost(entity: EntityCode): Promise<AnomalyCandidate[]> {
  const sb = supabaseServer();
  const since = daysAgoISO(90);
  const { data } = await sb.from("bank_movements")
    .select("id,entity_id,amount_eur,description,movement_date,reconciled_to")
    .eq("reconciled_to", "intercompany")
    .gte("movement_date", since);
  const rows = (data || []) as Array<{ id: string; entity_id: string; amount_eur: number; description: string | null; movement_date: string }>;
  const mine = rows.filter((r) => r.entity_id === entity);
  const out: AnomalyCandidate[] = [];
  for (const r of mine) {
    const abs = Math.abs(Number(r.amount_eur || 0));
    if (abs < INTERCOMPANY_MIN_EUR) continue;
    // A mirror on any other entity within ±2 days for the same absolute amount.
    const mirrors = rows.filter((c) => c.entity_id !== entity
      && Math.abs(Math.abs(Number(c.amount_eur || 0)) - abs) < 0.01
      && Math.abs(new Date(c.movement_date).getTime() - new Date(r.movement_date).getTime()) <= 2 * 86_400_000);
    if (mirrors.length > 0) continue;
    out.push({
      entity_code: entity,
      kind: "intercompany_ghost",
      description: "Intercompany flow €" + abs.toFixed(2) + " on " + r.movement_date + " has no counterpart mirror in the other entities.",
      severity: 4,
      meta: { _key: "icg:" + r.id, amount_eur: abs, movement_date: r.movement_date, description: (r.description || "").slice(0, 200) },
      source_table: "bank_movements",
      source_id: r.id,
      first_seen_date: r.movement_date,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Orchestration — run everything, upsert, log.
// --------------------------------------------------------------------------
export async function detectAll(entity: EntityCode, opts?: { user_id?: string | null }): Promise<{
  candidates: AnomalyCandidate[];
  upserted: number;
  by_kind: Record<AnomalyKind, number>;
}> {
  const detectors: Array<[AnomalyKind, () => Promise<AnomalyCandidate[]>]> = [
    ["eod_cash_ratio_high",         () => detectEodCashRatioHigh(entity)],
    ["eod_no_source",               () => detectEodNoSource(entity)],
    ["bank_movement_unmatched_long",() => detectBankUnmatchedLong(entity)],
    ["invoice_missing_supplier",    () => detectInvoiceMissingSupplier(entity)],
    ["invoice_amount_outlier",      () => detectInvoiceAmountOutlier(entity)],
    ["duplicate_asiento",           () => detectDuplicateAsiento(entity)],
    ["posting_before_bank",         () => detectPostingBeforeBank(entity)],
    ["vat_ratio_deviation",         () => detectVatRatioDeviation(entity)],
    ["intercompany_ghost",          () => detectIntercompanyGhost(entity)],
  ];

  const by_kind: Record<string, number> = {};
  const candidates: AnomalyCandidate[] = [];
  const results = await Promise.all(detectors.map(async ([k, fn]) => {
    try {
      const r = await fn();
      by_kind[k] = r.length;
      return r;
    } catch (e) {
      by_kind[k] = 0;
      console.warn("[anomaly-detector] " + k + " failed:", (e as any)?.message || e);
      return [] as AnomalyCandidate[];
    }
  }));
  for (const r of results) candidates.push(...r);

  const sb = supabaseServer();
  let upserted = 0;
  for (const c of candidates) {
    const meta_hash = hashMeta(c.entity_code, c.kind, c.meta || {});
    // Try to increment last_seen_date on the existing open row; if none, insert.
    const { data: existing } = await sb.from("finance_anomalies")
      .select("id,resolved_at")
      .eq("entity_code", c.entity_code)
      .eq("kind", c.kind)
      .eq("meta_hash", meta_hash)
      .maybeSingle();
    if (existing?.id) {
      await sb.from("finance_anomalies").update({
        last_seen_date: todayISO(),
        // Bring back rows that were auto-closed but re-appeared.
        resolved_at: existing.resolved_at ? null : null,
        updated_at: new Date().toISOString(),
        description: c.description,
        severity: c.severity,
        meta: c.meta,
        source_table: c.source_table ?? null,
        source_id: c.source_id ?? null,
      }).eq("id", existing.id);
    } else {
      await sb.from("finance_anomalies").insert({
        entity_code: c.entity_code,
        kind: c.kind,
        description: c.description,
        severity: c.severity,
        meta: c.meta,
        meta_hash,
        first_seen_date: c.first_seen_date || todayISO(),
        last_seen_date:  todayISO(),
        source_table:    c.source_table ?? null,
        source_id:       c.source_id ?? null,
      });
    }
    upserted += 1;
  }

  // Audit — every scan gets a row in assistant_actions.
  await sb.from("assistant_actions").insert({
    user_id: opts?.user_id || null,
    action_kind: "anomaly_scan",
    action_type: "finance.anomaly.scan",
    entity_code: entity,
    payload: { by_kind, upserted, candidates_total: candidates.length },
    reversible: false,
  });

  return { candidates, upserted, by_kind: by_kind as Record<AnomalyKind, number> };
}

// --------------------------------------------------------------------------
// Read helpers — used by the FAB, the UI, and the compass strip.
// --------------------------------------------------------------------------
export async function openAnomalies(entity: EntityCode) {
  const sb = supabaseServer();
  const { data } = await sb.from("v_finance_anomalies_open")
    .select("id,entity_code,kind,description,severity,detected_at,first_seen_date,last_seen_date,meta,source_table,source_id")
    .eq("entity_code", entity);
  return (data || []) as Array<{
    id: string; entity_code: EntityCode; kind: AnomalyKind; description: string;
    severity: number; detected_at: string; first_seen_date: string; last_seen_date: string;
    meta: any; source_table: string | null; source_id: string | null;
  }>;
}
