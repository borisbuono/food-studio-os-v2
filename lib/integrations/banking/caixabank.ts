import type { BankingAdapter } from "@/lib/integrations/types";
export const caixaBankBankingAdapter: BankingAdapter = { name: "CaixaBank Now", vendor: "caixabank", async listMovementsSince() { return []; } };
