import type { PosAdapter, PosDailySale } from "@/lib/integrations/types";
// Square POS stub. Wire to https://developer.squareup.com/reference/square/orders-api
// when the merchant credentials land. For now returns null and reports as 'stub'.
export const squareAdapter: PosAdapter = {
  name: "Square",
  vendor: "square",
  async pullDay() { return null; },
};
