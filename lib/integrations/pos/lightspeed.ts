import type { PosAdapter } from "@/lib/integrations/types";
export const lightspeedAdapter: PosAdapter = { name: "Lightspeed", vendor: "lightspeed", async pullDay() { return null; } };
