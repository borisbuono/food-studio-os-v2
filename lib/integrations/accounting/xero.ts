import type { AccountingAdapter } from "@/lib/integrations/types";
// Xero — https://developer.xero.com/documentation/api/accounting/overview
export const xeroAdapter: AccountingAdapter = {
  name: "Xero", vendor: "xero",
  async postSalesReceipt() { return { external_id: "stub", dryRun: true }; },
  async listUnapprovedPurchases() { return []; },
  async listMovementsSince() { return []; },
};
