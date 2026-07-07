import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "./consolidator";

// Intercompany flows read helper.
//
// Two known material flows to render:
//   1. BBH → BM loan (per memory [[bbh_bm_intercompany_loan]]) — multi-year
//      cash lending, only material intercompany of size.
//   2. IFL → BM procurement (per [[intercompany_procurement_taller_mondo]]) —
//      Mondo runs procurement + production for Taller catering; costs flow
//      through and get invoiced or settled between the two.
//
// Per finance backbone spec there's a scoped `intercompany_flows` table that
// will hold booked mirror asientos. Until that lands, this helper reads from
// bank_movements where reconciled_to = 'intercompany' as the closest proxy.
// If neither table has data, returns the known flows as booking_status =
// 'bank_only' with zero amounts so the UI still renders the shape.

export type FlowBookingStatus = "bank_only" | "mirror_posted" | "documented" | "unknown";

export type IntercompanyFlow = {
  from: EntityCode;
  to: EntityCode;
  kind: string;
  this_month_eur: number;
  cumulative_eur: number;
  booking_status: FlowBookingStatus;
  needs_mirror: boolean;
};

const KNOWN_FLOWS: Array<{ from: EntityCode; to: EntityCode; kind: string }> = [
  { from: "BBH", to: "BM",  kind: "Shareholder loan" },
  { from: "IFL", to: "BM",  kind: "Procurement + catering production" },
];

function monthStartISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// Best-effort direction inference from a bank movement description. Bank
// movements only carry entity_id (the account owner); the counterparty has to
// be read from the description. We look for the other entity's code or brand
// mentions. Coarse but honest — if we can't tell, we skip.
function inferCounterparty(entity: EntityCode, description: string | null | undefined): EntityCode | null {
  const t = (description || "").toUpperCase();
  const has = (needles: string[]) => needles.some((n) => t.includes(n));
  if (entity !== "BBH" && has(["BBH", "BUONO HOLD", "BORIS BUONO HOLDINGS"])) return "BBH";
  if (entity !== "BM"  && has(["BM", "BISTRO MONDO", "BISTROT MONDO", "MONDO"])) return "BM";
  if (entity !== "IFL" && has(["IFL", "IBIZA FOOD", "TALLER", "TALLER SA PENYA"])) return "IFL";
  return null;
}

export async function getIntercompanyFlows(): Promise<IntercompanyFlow[]> {
  const supabase = supabaseServer();

  // Prefer intercompany_flows table if it exists.
  const table = await supabase.from("intercompany_flows").select("from_entity,to_entity,kind,this_month_eur,cumulative_eur,booking_status").then(
    (r: any) => r,
    () => ({ data: null, error: { message: "table missing" } } as any),
  );

  if (table && !table.error && Array.isArray(table.data) && table.data.length) {
    return (table.data as any[]).map((row) => ({
      from: (String(row.from_entity || "").toUpperCase() as EntityCode) || "IFL",
      to: (String(row.to_entity || "").toUpperCase() as EntityCode) || "BM",
      kind: String(row.kind || "Intercompany"),
      this_month_eur: Number(row.this_month_eur || 0),
      cumulative_eur: Number(row.cumulative_eur || 0),
      booking_status: (row.booking_status as FlowBookingStatus) || "bank_only",
      needs_mirror: (row.booking_status || "bank_only") === "bank_only",
    }));
  }

  // Fallback — aggregate from bank_movements reconciled_to = 'intercompany'.
  const since = monthStartISO();
  const mv = await supabase.from("bank_movements").select("entity_id,amount_eur,description,movement_date").eq("reconciled_to", "intercompany");

  // Seed with known flows so the shape always renders, even when empty.
  const map = new Map<string, IntercompanyFlow>();
  for (const f of KNOWN_FLOWS) {
    const key = `${f.from}->${f.to}`;
    map.set(key, {
      from: f.from,
      to: f.to,
      kind: f.kind,
      this_month_eur: 0,
      cumulative_eur: 0,
      booking_status: "bank_only",
      needs_mirror: true,
    });
  }

  if (mv && !mv.error && Array.isArray(mv.data)) {
    for (const row of mv.data as any[]) {
      const owner = (row.entity_id || "").toUpperCase() as EntityCode;
      const counter = inferCounterparty(owner, row.description);
      if (!counter) continue;
      const amt = Number(row.amount_eur || 0);
      // Money leaving the owner (negative) → owner is "from". Positive → "to".
      const from = amt < 0 ? owner : counter;
      const to   = amt < 0 ? counter : owner;
      const key = `${from}->${to}`;
      const abs = Math.abs(amt);
      const existing = map.get(key) || {
        from, to,
        kind: "Intercompany transfer",
        this_month_eur: 0,
        cumulative_eur: 0,
        booking_status: "bank_only" as FlowBookingStatus,
        needs_mirror: true,
      };
      existing.cumulative_eur += abs;
      if (String(row.movement_date || "") >= since) existing.this_month_eur += abs;
      map.set(key, existing);
    }
  }

  return Array.from(map.values());
}

export async function countUnbookedIntercompany(): Promise<number> {
  const flows = await getIntercompanyFlows();
  return flows.filter((f) => f.needs_mirror).length;
}
