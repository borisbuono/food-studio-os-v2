import type { PaymentAdapter } from "@/lib/integrations/types";
// CaixaBank merchant settlement — what IFL + BM use today (TPV under CaixaBank 6484/57200001)
export const caixaBankAdapter: PaymentAdapter = { name: "CaixaBank Merchant", vendor: "caixabank", async pullSettlementsSince() { return []; } };
