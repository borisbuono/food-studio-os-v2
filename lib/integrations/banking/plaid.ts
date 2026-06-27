import type { BankingAdapter } from "@/lib/integrations/types";
export const plaidAdapter: BankingAdapter = { name: "Plaid", vendor: "plaid", async listMovementsSince() { return []; } };
