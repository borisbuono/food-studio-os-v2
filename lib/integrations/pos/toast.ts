import type { PosAdapter } from "@/lib/integrations/types";
export const toastAdapter: PosAdapter = { name: "Toast", vendor: "toast", async pullDay() { return null; } };
