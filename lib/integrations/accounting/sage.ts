import type { AccountingAdapter } from "@/lib/integrations/types";
// Sage Business Cloud — common in Spain alongside Holded
export const sageAdapter: AccountingAdapter = {
  name: "Sage", vendor: "sage",
  async postSalesReceipt() { return { external_id: "stub", dryRun: true }; },
  async listUnapprovedPurchases() { return []; },
  async listMovementsSince() { return []; },
};
