import type { BookingAdapter } from "@/lib/integrations/types";
export const theForkAdapter: BookingAdapter = { name: "TheFork", vendor: "thefork", async pullDay() { return []; } };
