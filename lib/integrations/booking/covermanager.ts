import type { BookingAdapter } from "@/lib/integrations/types";
export const coverManagerAdapter: BookingAdapter = { name: "CoverManager", vendor: "covermanager", async pullDay() { return []; } };
