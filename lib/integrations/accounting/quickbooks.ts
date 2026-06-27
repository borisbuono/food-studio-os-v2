import type { AccountingAdapter } from "@/lib/integrations/types";
// Intuit QuickBooks Online — https://developer.intuit.com/app/developer/qbo/docs/api/accounting
export const quickbooksAdapter: AccountingAdapter = {
  name: "QuickBooks Online", vendor: "quickbooks",
  async postSalesReceipt() { return { external_id: "stub", dryRun: true }; },
  async listUnapprovedPurchases() { return []; },
  async listMovementsSince() { return []; },
};
