import type { PaymentAdapter } from "@/lib/integrations/types";
export const stripeAdapter: PaymentAdapter = { name: "Stripe", vendor: "stripe", async pullSettlementsSince() { return []; } };
