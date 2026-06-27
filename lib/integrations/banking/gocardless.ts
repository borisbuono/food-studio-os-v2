import type { BankingAdapter } from "@/lib/integrations/types";
// GoCardless Bank Account Data (formerly Nordigen) — free PSD2 read, covers CaixaBank
export const goCardlessAdapter: BankingAdapter = { name: "GoCardless BAD", vendor: "gocardless", async listMovementsSince() { return []; } };
