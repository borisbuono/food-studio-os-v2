import type { AccountingAdapter, AccountingSalesReceipt, AccountingPurchase, AccountingMovement, EntityCode } from "@/lib/integrations/types";

// Apideck unified accounting API — abstracts Holded/QuickBooks/Xero/etc. behind one interface.
// Per-entity consumer_id is either read from env (APIDECK_CONSUMER_ID_{IFL,BM,BBH}) or defaults
// to the entity code itself (matches consumers created 2026-07-04: IFL, BM, BBH).
//
// service_id defaults to "holded" but can be flipped per entity via env (APIDECK_SERVICE_ID_{IFL,BM,BBH})
// so a future advisory client on Xero swaps to "xero+2" or similar without any code change here.

const BASE = "https://unify.apideck.com";
const DRY_RUN = process.env.FS_APIDECK_DRY_RUN !== "false"; // default ON, same posture as Holded direct

function consumerFor(entity: EntityCode): string {
  return process.env[`APIDECK_CONSUMER_ID_${entity}`] || entity;
}
function serviceFor(entity: EntityCode): string {
  return process.env[`APIDECK_SERVICE_ID_${entity}`] || "holded";
}

function baseHeaders(entity: EntityCode): Record<string, string> {
  const appId = process.env.APIDECK_APP_ID;
  const apiKey = process.env.APIDECK_API_KEY;
  if (!appId || !apiKey) throw new Error("APIDECK_APP_ID / APIDECK_API_KEY not configured in env");
  return {
    "Authorization": `Bearer ${apiKey}`,
    "x-apideck-app-id": appId,
    "x-apideck-consumer-id": consumerFor(entity),
    "x-apideck-service-id": serviceFor(entity),
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
}

// Apideck's unified accounting schema uses camelCase JSON. Their models:
//   /accounting/invoices          — sales invoices (issued to customers)
//   /accounting/bills             — supplier bills (purchases, "unapproved" tracked via drafts)
//   /accounting/payments          — payments in/out
//   /accounting/journal-entries   — asientos
//   /accounting/ledger-accounts   — chart of accounts (PGC codes)
//
// For our AccountingAdapter contract:
//   postSalesReceipt         → POST /accounting/invoices (with paid_status=paid)
//   listUnapprovedPurchases  → GET /accounting/bills?filter[status]=draft (or =open)
//   listMovementsSince       → not directly mapped by Apideck accounting API; use payments endpoint

export const apideckAdapter: AccountingAdapter = {
  name: "Apideck (Holded)",
  vendor: "apideck",

  async postSalesReceipt(input: AccountingSalesReceipt) {
    const consumer = consumerFor(input.entity);
    const service = serviceFor(input.entity);

    // Map our 4-line VAT preview into Apideck's line_items structure
    const line_items = input.lines.map((l) => ({
      description: l.description,
      quantity: 1,
      unit_price: l.net_eur,
      tax_rate: { total_rate: l.vat_rate },
      ledger_account: { nominal_code: l.account_code },
    }));

    const payload = {
      type: "standard",
      number: `POS-${input.date}`,
      invoice_date: input.date,
      due_date: input.date,
      paid_date: input.date,
      paid_status: "paid",
      status: "authorised",
      description: input.description,
      line_items,
    };

    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log("[apideck:dry-run] would POST invoice", JSON.stringify({ consumer, service, payload }, null, 2));
      return { external_id: "dry-run-" + Date.now(), dryRun: true };
    }

    const r = await fetch(`${BASE}/accounting/invoices`, {
      method: "POST",
      headers: baseHeaders(input.entity),
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Apideck invoices POST ${r.status}: ${(await r.text().catch(() => "")).slice(0, 400)}`);
    const d = await r.json();
    return { external_id: String(d?.data?.id || ""), dryRun: false };
  },

  async listUnapprovedPurchases(entity: EntityCode): Promise<AccountingPurchase[]> {
    // Apideck's "bills" resource — filter to non-final states so we mirror Holded's
    // "not approved" invoice inbox concept.
    const url = `${BASE}/accounting/bills?limit=100&filter[status]=draft&filter[status]=open`;
    const r = await fetch(url, { headers: baseHeaders(entity) });
    if (!r.ok) return [];
    const d = await r.json();
    const rows: any[] = d?.data || [];
    return rows.map((b) => ({
      external_id: String(b.id || ""),
      date: b.bill_date || b.due_date || new Date().toISOString().slice(0, 10),
      supplier_name: b.supplier?.display_name || b.supplier?.company_name || null,
      amount_eur: Number(b.total || b.subtotal || 0),
      vat_eur: Number(b.total_tax || 0),
      status: "unapproved" as const,
      url: b.deep_link || undefined,
    }));
  },

  async listMovementsSince(entity: EntityCode, sinceUnixSec: number): Promise<AccountingMovement[]> {
    // Apideck's accounting API surfaces payments, not raw bank movements. Use payments as a proxy
    // for treasury-movement style listing; real bank movements come via the Banking adapter (Tink/etc).
    const sinceIso = new Date(sinceUnixSec * 1000).toISOString().slice(0, 10);
    const url = `${BASE}/accounting/payments?limit=100&filter[updated_since]=${sinceIso}`;
    const r = await fetch(url, { headers: baseHeaders(entity) });
    if (!r.ok) return [];
    const d = await r.json();
    const rows: any[] = d?.data || [];
    return rows.map((p) => ({
      external_id: String(p.id || ""),
      date: p.payment_date || p.updated_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      description: p.reference || p.note || "",
      amount_eur: Number(p.total_amount || 0),
      bank_account: p.account?.name || p.account?.nominal_code || "",
    }));
  },
};

// ============================================================
// Vault Session helper — for the Connect flow. Returns a session URI the client can
// redirect to. This replaces the paste-a-key flow: users authorize via Apideck's hosted UI.
// ============================================================
export async function createApideckVaultSession(entity: EntityCode): Promise<string> {
  const appId = process.env.APIDECK_APP_ID;
  const apiKey = process.env.APIDECK_API_KEY;
  if (!appId || !apiKey) throw new Error("APIDECK_APP_ID / APIDECK_API_KEY not configured in env");
  const r = await fetch(`${BASE}/vault/sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "x-apideck-app-id": appId,
      "x-apideck-consumer-id": consumerFor(entity),
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      settings: {
        // Show only the accounting connectors; scope to Holded for now
        unified_apis: ["accounting"],
        session_length: "30m",
      },
    }),
  });
  if (!r.ok) throw new Error(`Apideck vault session ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = await r.json();
  return String(d?.data?.session_uri || d?.data?.uri || "");
}
