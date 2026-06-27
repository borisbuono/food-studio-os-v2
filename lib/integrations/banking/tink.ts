import type { BankingAdapter } from "@/lib/integrations/types";
// Tink (Visa) — strong EU PSD2 coverage incl. CaixaBank
export const tinkAdapter: BankingAdapter = { name: "Tink", vendor: "tink", async listMovementsSince() { return []; } };
