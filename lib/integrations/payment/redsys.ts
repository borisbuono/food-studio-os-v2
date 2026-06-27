import type { PaymentAdapter } from "@/lib/integrations/types";
// Redsys — the Spanish acquirer behind most local merchant banks (BBVA, Santander, Sabadell)
export const redsysAdapter: PaymentAdapter = { name: "Redsys", vendor: "redsys", async pullSettlementsSince() { return []; } };
