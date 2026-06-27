import type { BookingAdapter } from "@/lib/integrations/types";
export const openTableAdapter: BookingAdapter = { name: "OpenTable", vendor: "opentable", async pullDay() { return []; } };
