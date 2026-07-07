import { supabaseServer } from "@/lib/supabaseServer";
import { RESTAURANT_TO_ENTITY, ENTITY_TO_RESTAURANT } from "@/lib/entities";

// Holdings Console — consolidated read helpers.
//
// The console rolls up numbers across every operating entity into a group view.
// Each helper reads the same operational tables the per-entity dashboards read
// (bank_movements, invoice_inbox, eod_reports, providers, etc.), so there's no
// new data store to maintain — the consolidation IS the value.
//
// Tolerant everywhere: if a source table is empty or missing a column, the
// helper returns zeroes / "—" placeholders rather than throwing. The console
// stays useful even before Chift/Apideck has back-filled bank_accounts.
//
// Entity codes are the text keys used across bank_movements.entity_id and
// invoice_inbox.entity_id: "IFL" (Ibiza Food Studios / Taller), "BM" (Bistro
// Mondo), "BBH" (Boris Buono Holdings — parent).

export type EntityCode = "IFL" | "BM" | "BBH";
export const ENTITY_CODES: EntityCode[] = ["IFL", "BM", "BBH"];

export type ByEntity<T> = Record<EntityCode, T>;

const zeroByEntity = (): ByEntity<number> => ({ IFL: 0, BM: 0, BBH: 0 });

// ─── Cash ────────────────────────────────────────────────────────────────
// Sums bank_accounts.balance_eur per entity when the table exists. If the
// Chift/Apideck balance sync hasn't populated it yet, falls back to summing
// the running total of bank_movements.amount_eur per entity — imperfect but
// non-empty. The UI displays "—" when everything comes back zero.

export async function getGroupCashToday(): Promise<{ by_entity: ByEntity<number>; total: number; source: "bank_accounts" | "bank_movements" | "empty" }> {
  const supabase = supabaseServer();
  const by_entity = zeroByEntity();
  let source: "bank_accounts" | "bank_movements" | "empty" = "empty";

  // Prefer bank_accounts.balance_eur if the table has been provisioned.
  const accts = await supabase.from("bank_accounts").select("entity_id,balance_eur").maybeSingle().then(
    () => supabase.from("bank_accounts").select("entity_id,balance_eur"),
    () => ({ data: null, error: { message: "table missing" } } as any),
  );

  if (accts && !accts.error && Array.isArray(accts.data) && accts.data.length) {
    source = "bank_accounts";
    for (const row of accts.data as any[]) {
      const ec = (row.entity_id || "").toUpperCase();
      if (ec === "IFL" || ec === "BM" || ec === "BBH") {
        by_entity[ec as EntityCode] += Number(row.balance_eur || 0);
      }
    }
  } else {
    // Fallback — sum bank_movements as a rough running balance per entity.
    const mv = await supabase.from("bank_movements").select("entity_id,amount_eur");
    if (mv && !mv.error && Array.isArray(mv.data) && mv.data.length) {
      source = "bank_movements";
      for (const row of mv.data as any[]) {
        const ec = (row.entity_id || "").toUpperCase();
        if (ec === "IFL" || ec === "BM" || ec === "BBH") {
          by_entity[ec as EntityCode] += Number(row.amount_eur || 0);
        }
      }
    }
  }

  const total = by_entity.IFL + by_entity.BM + by_entity.BBH;
  return { by_entity, total, source };
}

// ─── Revenue MTD ─────────────────────────────────────────────────────────
// Sums eod_reports.revenue for the current calendar month, grouped by entity
// via restaurant_id → entity mapping (RESTAURANT_TO_ENTITY). If eod_accounting
// lands as the canonical table later, add a preference for it above this.

function monthStartISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function getGroupRevenueMTD(): Promise<{ by_entity: ByEntity<number>; total: number; source: "eod_accounting" | "eod_reports" | "empty" }> {
  const supabase = supabaseServer();
  const by_entity = zeroByEntity();
  let source: "eod_accounting" | "eod_reports" | "empty" = "empty";
  const since = monthStartISO();

  // Prefer eod_accounting.total_gross_eur if the table exists (spec target).
  const acc = await supabase.from("eod_accounting").select("restaurant_id,total_gross_eur,report_date").gte("report_date", since).then(
    (r: any) => r,
    () => ({ data: null, error: { message: "table missing" } } as any),
  );

  const RID_TO_EC: Record<string, EntityCode> = {};
  for (const [rid, ek] of Object.entries(RESTAURANT_TO_ENTITY)) {
    if (ek === "bistro_mondo") RID_TO_EC[rid] = "BM";
    else if (ek === "taller" || ek === "utopia") RID_TO_EC[rid] = "IFL";
    else if (ek === "holdings") RID_TO_EC[rid] = "BBH";
  }

  if (acc && !acc.error && Array.isArray(acc.data) && acc.data.length) {
    source = "eod_accounting";
    for (const row of acc.data as any[]) {
      const ec = RID_TO_EC[row.restaurant_id];
      if (ec) by_entity[ec] += Number(row.total_gross_eur || 0);
    }
  } else {
    // Fallback to eod_reports.revenue — what the per-entity dashboards use.
    const rep = await supabase.from("eod_reports").select("restaurant_id,revenue,report_date").gte("report_date", since);
    if (rep && !rep.error && Array.isArray(rep.data) && rep.data.length) {
      source = "eod_reports";
      for (const row of rep.data as any[]) {
        const ec = RID_TO_EC[row.restaurant_id];
        if (ec) by_entity[ec] += Number(row.revenue || 0);
      }
    }
  }

  const total = by_entity.IFL + by_entity.BM + by_entity.BBH;
  return { by_entity, total, source };
}

// ─── Open payables ───────────────────────────────────────────────────────
// Counts + sums invoice_inbox rows that aren't yet settled. Uses match_status
// as the closest proxy the schema exposes: anything not in {approved (== paid
// in the current flow), rejected, duplicate} is "open" for owner purposes.

export async function getGroupOpenPayables(): Promise<{ by_entity_count: ByEntity<number>; by_entity_sum: ByEntity<number>; total_count: number; total_sum: number }> {
  const supabase = supabaseServer();
  const by_entity_count = zeroByEntity();
  const by_entity_sum = zeroByEntity();

  const r = await supabase.from("invoice_inbox").select("entity_id,amount_eur,match_status").not("match_status", "in", "(approved,rejected,duplicate)");
  if (r && !r.error && Array.isArray(r.data)) {
    for (const row of r.data as any[]) {
      const ec = (row.entity_id || "").toUpperCase();
      if (ec === "IFL" || ec === "BM" || ec === "BBH") {
        by_entity_count[ec as EntityCode] += 1;
        by_entity_sum[ec as EntityCode] += Math.abs(Number(row.amount_eur || 0));
      }
    }
  }

  const total_count = by_entity_count.IFL + by_entity_count.BM + by_entity_count.BBH;
  const total_sum = by_entity_sum.IFL + by_entity_sum.BM + by_entity_sum.BBH;
  return { by_entity_count, by_entity_sum, total_count, total_sum };
}

// ─── Next tax filing ─────────────────────────────────────────────────────
// Reads modelos_filed when it exists; otherwise seeds a small deadline list
// from what we know: Q2 2026 Modelo 303 is due Jul 20 for IFL and BM. Returns
// the closest future deadline (soonest days_until).

export type Filing = { modelo: string; entity: EntityCode; period: string; due_date: string; days_until: number; status: string };

const KNOWN_DEADLINES_2026: Filing[] = [
  { modelo: "303", entity: "IFL", period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
  { modelo: "303", entity: "BM",  period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
  { modelo: "111", entity: "IFL", period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
  { modelo: "111", entity: "BM",  period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
  { modelo: "115", entity: "IFL", period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
  { modelo: "115", entity: "BM",  period: "Q2 2026", due_date: "2026-07-20", days_until: 0, status: "due" },
];

function daysUntil(iso: string): number {
  const now = new Date();
  const then = new Date(iso + "T00:00:00Z");
  return Math.ceil((then.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export async function getGroupFilings(): Promise<Filing[]> {
  const supabase = supabaseServer();

  const r = await supabase.from("modelos_filed").select("modelo,entity_id,period,due_date,status").then(
    (rr: any) => rr,
    () => ({ data: null, error: { message: "table missing" } } as any),
  );

  let rows: Filing[] = [];
  if (r && !r.error && Array.isArray(r.data) && r.data.length) {
    rows = (r.data as any[]).map((row) => ({
      modelo: String(row.modelo || ""),
      entity: (String(row.entity_id || "").toUpperCase() as EntityCode) || "IFL",
      period: String(row.period || ""),
      due_date: String(row.due_date || ""),
      days_until: row.due_date ? daysUntil(row.due_date) : 0,
      status: String(row.status || "draft"),
    }));
  } else {
    rows = KNOWN_DEADLINES_2026.map((f) => ({ ...f, days_until: daysUntil(f.due_date) }));
  }

  return rows.sort((a, b) => a.days_until - b.days_until);
}

export async function getNextTaxFiling(): Promise<Filing | null> {
  const filings = await getGroupFilings();
  const future = filings.filter((f) => f.days_until >= 0);
  return future.length ? future[0] : filings[0] || null;
}

// ─── Flags requiring owner ──────────────────────────────────────────────
// Aggregates the "things Boris should look at" list: unmatched bank movements
// older than 7 days, high-value invoices without documents, plus optional
// disabled ad accounts if the platform_billing_status tile exists.

export type Flag = { entity: EntityCode; kind: string; count: number; urgency: "red" | "amber" | "green" };

export async function getFlagsRequiringOwner(): Promise<Flag[]> {
  const supabase = supabaseServer();
  const flags: Flag[] = [];

  // Unmatched bank movements > 7 days old
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);
  const stale = await supabase.from("bank_movements").select("entity_id,movement_date").eq("reconciled_to", "unmatched").lt("movement_date", cutoff);
  if (stale && !stale.error && Array.isArray(stale.data)) {
    const grouped: ByEntity<number> = zeroByEntity();
    for (const row of stale.data as any[]) {
      const ec = (row.entity_id || "").toUpperCase();
      if (ec === "IFL" || ec === "BM" || ec === "BBH") grouped[ec as EntityCode] += 1;
    }
    for (const ec of ENTITY_CODES) {
      if (grouped[ec] > 0) flags.push({ entity: ec, kind: "Unmatched bank > 7d", count: grouped[ec], urgency: grouped[ec] > 5 ? "red" : "amber" });
    }
  }

  // High-value invoices without a doc_url
  const noDoc = await supabase.from("invoice_inbox").select("entity_id,amount_eur,doc_url").is("doc_url", null).gte("amount_eur", 500);
  if (noDoc && !noDoc.error && Array.isArray(noDoc.data)) {
    const grouped: ByEntity<number> = zeroByEntity();
    for (const row of noDoc.data as any[]) {
      const ec = (row.entity_id || "").toUpperCase();
      if (ec === "IFL" || ec === "BM" || ec === "BBH") grouped[ec as EntityCode] += 1;
    }
    for (const ec of ENTITY_CODES) {
      if (grouped[ec] > 0) flags.push({ entity: ec, kind: "Invoice > €500 no doc", count: grouped[ec], urgency: "amber" });
    }
  }

  // Disabled ad accounts / payment problems, if the table exists
  const pay = await supabase.from("platform_billing_status").select("entity_id,platform,status").eq("status", "disabled").then(
    (r: any) => r,
    () => ({ data: null, error: { message: "table missing" } } as any),
  );
  if (pay && !pay.error && Array.isArray(pay.data) && pay.data.length) {
    const grouped: ByEntity<number> = zeroByEntity();
    for (const row of pay.data as any[]) {
      const ec = (row.entity_id || "").toUpperCase();
      if (ec === "IFL" || ec === "BM" || ec === "BBH") grouped[ec as EntityCode] += 1;
    }
    for (const ec of ENTITY_CODES) {
      if (grouped[ec] > 0) flags.push({ entity: ec, kind: "Ad account disabled", count: grouped[ec], urgency: "red" });
    }
  }

  return flags;
}

// ─── Small convenience — count flags by entity ──────────────────────────

export async function getFlagCountsByEntity(): Promise<ByEntity<number>> {
  const flags = await getFlagsRequiringOwner();
  const c: ByEntity<number> = zeroByEntity();
  for (const f of flags) c[f.entity] += f.count;
  return c;
}

// Re-export the restaurant lookup for pages that link into per-entity views.
export { RESTAURANT_TO_ENTITY, ENTITY_TO_RESTAURANT };
