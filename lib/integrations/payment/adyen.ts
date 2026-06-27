import type { PaymentAdapter } from "@/lib/integrations/types";
export const adyenAdapter: PaymentAdapter = { name: "Adyen", vendor: "adyen", async pullSettlementsSince() { return []; } };
