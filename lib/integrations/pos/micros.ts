import type { PosAdapter } from "@/lib/integrations/types";
// Oracle MICROS / Simphony. Most legacy fine-dining sites use MICROS exports nightly.
export const microsAdapter: PosAdapter = { name: "MICROS", vendor: "micros", async pullDay() { return null; } };
