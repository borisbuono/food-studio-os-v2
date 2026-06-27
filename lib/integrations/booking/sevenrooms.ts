import type { BookingAdapter } from "@/lib/integrations/types";
export const sevenRoomsAdapter: BookingAdapter = { name: "SevenRooms", vendor: "sevenrooms", async pullDay() { return []; } };
