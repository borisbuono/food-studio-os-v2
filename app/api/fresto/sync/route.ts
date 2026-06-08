import { getFrestoAdapter } from "@/lib/integrations/fresto";
import { serverRestaurantId } from "@/lib/serverVenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only fresto sync scaffold. GET /api/fresto/sync?date=YYYY-MM-DD
// Returns the venue's bookings + rolled-up sales for the date through whichever adapter
// is active (live when connected, mock otherwise). This is the seam the Office home
// "live sales pulse" (Day 7) and the floor-plan overlay read from — one place to swap
// mock → live once Lars's API lands. It only READS; nothing is written or sent.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const restaurantId = serverRestaurantId();
  try {
    const fresto = await getFrestoAdapter(restaurantId);
    const [bookings, sales, tables, health] = await Promise.all([
      fresto.getBookings(date),
      fresto.getSalesSummary(date),
      fresto.getTables(),
      fresto.health(),
    ]);
    return Response.json({
      ok: true,
      mode: fresto.mode,        // "mock" until fresto is connected
      restaurantId,
      date,
      health,
      sales,
      tableCount: tables.length,
      bookingCount: bookings.length,
      unassigned: bookings.filter((b) => !b.tableLabel && b.status !== "cancelled").length,
      bookings,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "fresto sync failed" }, { status: 200 });
  }
}
