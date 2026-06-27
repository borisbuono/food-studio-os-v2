import type { AccountingAdapter, AccountingSalesReceipt, AccountingPurchase, AccountingMovement, EntityCode } from "@/lib/integrations/types";

// Per-entity Holded API key + chart-of-accounts mapping.
// Server-only — never imported from client components.
// See memory [[holded_api_reference]] for header convention + base URL.

const BASE = "https://api.holded.com/api/invoicing/v1";

const ENTITY_KEY: Record<EntityCode, string | undefined> = {
  IFL: process.env.HOLDED_API_KEY_TALLER,
  BM:  process.env.HOLDED_API_KEY_BISTRO_MONDO,
  BBH: process.env.HOLDED_API_KEY_HOLDINGS,
};

// Spanish PGC account codes per entity for the 4 revenue groups.
// IFL = flat 10% VAT on everything (per [[ifl_vat_flat_10pct]]).
// BM  = food 10% / wine + bar 21% / tips no VAT.
type Group = "food" | "wine" | "bar" | "softdrinks" | "tips" | "other";
const ACCOUNT: Record<EntityCode, Partial<Record<Group, string>>> = {
  IFL: { food: "70500001", wine: "70500002", bar: "70500003", softdrinks: "70500004", tips: "70500006", other: "70500099" },
  BM:  { food: "70000001", wine: "70000002", bar: "70000003", softdrinks: "70000004", tips: "70000006", other: "70000099" },
  BBH: { other: "70000099" },
};

const DRY_RUN = process.env.FS_HOLDED_DRY_RUN !== "false"; // default ON

export const holdedAdapter: AccountingAdapter = {
  name: "Holded",
  vendor: "holded",

  async postSalesReceipt(input: AccountingSalesReceipt) {
    const key = ENTITY_KEY[input.entity];
    if (!key) throw new Error(`No Holded API key configured for entity ${input.entity}`);

    const payload = {
      contactCode: "POS",
      desc: input.description,
      date: Math.floor(new Date(input.date + "T00:00:00Z").getTime() / 1000), // Holded uses Unix seconds per [[holded_api_reference]]
      items: input.lines.map((l) => ({
        name: l.description,
        units: 1,
        subtotal: l.net_eur,
        tax: l.vat_rate,
        accountId: l.account_code,
      })),
    };

    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log("[holded:dry-run] would POST salesreceipt", JSON.stringify({ entity: input.entity, payload }, null, 2));
      return { external_id: "dry-run-" + Date.now(), dryRun: true };
    }

    const r = await fetch(`${BASE}/documents/salesreceipt`, {
      method: "POST",
      headers: { key, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Holded POST salesreceipt ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { external_id: d.id || d.invoiceNum || "", dryRun: false };
  },

  async listUnapprovedPurchases(entity: EntityCode): Promise<AccountingPurchase[]> {
    const key = ENTITY_KEY[entity];
    if (!key) return [];
    const r = await fetch(`${BASE}/documents/purchase?type=purchase`, { headers: { key } });
    if (!r.ok) return [];
    const docs = await r.json();
    return (docs || [])
      .filter((d: any) => d.status !== 3 && !d.approvedAt) // status=3 = CANCELLED per [[holded_data_model]]
      .map((d: any) => ({
        external_id: String(d.id || d.invoiceNum || ""),
        date: new Date((d.date || 0) * 1000).toISOString().slice(0, 10),
        supplier_name: d.contactName || null,
        amount_eur: Number(d.total || 0),
        vat_eur: Number(d.totalTax || 0),
        status: "unapproved" as const,
      }));
  },

  async listMovementsSince(entity: EntityCode, sinceUnixSec: number): Promise<AccountingMovement[]> {
    const key = ENTITY_KEY[entity];
    if (!key) return [];
    const r = await fetch(`${BASE}/treasury/movements?starttmp=${sinceUnixSec}`, { headers: { key } });
    if (!r.ok) return [];
    const movs = await r.json();
    return (movs || []).map((m: any) => ({
      external_id: String(m.id || ""),
      date: new Date((m.date || 0) * 1000).toISOString().slice(0, 10),
      bank_account: String(m.account || ""),
      amount_eur: Number(m.amount || 0),
      description: m.desc || "",
    }));
  },
};

// Helper exposed for the EOD page so the same VAT logic + account-mapping renders the preview.
export function eodLinesForEntity(
  entity: EntityCode,
  totals: { food: number; wine: number; bar: number; softdrinks: number; tips: number }
): AccountingSalesReceipt["lines"] {
  const vatFor = (g: Group): 0 | 10 | 21 => {
    if (entity === "IFL") return 10;
    if (entity === "BM") {
      if (g === "wine" || g === "bar") return 21;
      if (g === "tips") return 0;
      return 10;
    }
    return 0;
  };
  const map = ACCOUNT[entity] || {};
  const out: AccountingSalesReceipt["lines"] = [];
  const groups: Group[] = ["food", "wine", "bar", "softdrinks", "tips"];
  for (const g of groups) {
    const net = Number((totals as any)[g] || 0);
    if (!net) continue;
    const code = map[g] || map.other || "70000099";
    out.push({ account_code: code, description: g.charAt(0).toUpperCase() + g.slice(1), net_eur: net, vat_rate: vatFor(g) });
  }
  return out;
}
