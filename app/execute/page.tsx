import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

// Architecture v2 — the Execute pillar landing.
// Four tiles, same shape as Grow and Administrate. Each tile = big number
// + one-sentence status + primary action. Data reads live from Supabase.
export default async function ExecuteHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

  // ---- data ---------------------------------------------------------------
  const [zonesRes, mepRes, tasksRes, albaransRes, bookingsRes] = await Promise.all([
    supabase.from("zones").select("id,restaurant_id").eq("restaurant_id", rid),
    supabase.from("mep_dishes").select("id,zone_id,is_active").eq("is_active", true),
    supabase.from("tasks").select("id,zone_id,frequency_rule").eq("is_active", true).eq("task_type", "cleaning"),
    supabase.from("albarans").select("id,received_at,restaurant_id").eq("restaurant_id", rid).gte("received_at", today + "T00:00:00").lt("received_at", today + "T23:59:59"),
    supabase.from("bookings").select("id,party_size,status,service_date").eq("restaurant_id", rid).eq("service_date", today),
  ]);

  const zoneIds = new Set((zonesRes.data || []).map((z: any) => z.id));
  const prep = (mepRes.data || []).filter((m: any) => zoneIds.has(m.zone_id)).length;
  const cleaningDue = (tasksRes.data || []).filter((t: any) => zoneIds.has(t.zone_id) && ((t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday)).length;
  const albarans = (albaransRes.data || []).length;
  const bookings = (bookingsRes.data || []).filter((b: any) => !["cancelled", "no_show"].includes((b.status || "").toLowerCase()));
  const coversBooked = bookings.reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <PillarHeader
        kicker="Execute · today"
        title="The daily loop."
        blurb="Morning → deliveries → prep → service → EOD. What's moving in the venue right now."
      />

      <section className="mt-10">
        <PillarTile
          href="/execute/handover"
          kicker="The Pass · prep + cleaning"
          title="Handover"
          value={prep + cleaningDue}
          status={prep + cleaningDue === 0
            ? "Nothing on the list — start the day."
            : `${prep} prep · ${cleaningDue} cleaning due today`}
          action="Open the pass →"
        />
        <PillarTile
          href="/execute/receiving"
          kicker="Deliveries · today"
          title="Receiving"
          value={albarans}
          status={albarans === 0
            ? "No deliveries logged yet — photograph the albarán."
            : `${albarans} albarán${albarans === 1 ? "" : "s"} received today`}
          action="Receive a delivery →"
        />
        <PillarTile
          href="/execute/floor"
          kicker="Service · tonight"
          title="Floor plan"
          value={coversBooked}
          status={coversBooked === 0
            ? "No bookings yet — the book fills when reservations come in."
            : `${coversBooked} covers across ${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
          action="Open the floor →"
        />
        <PillarTile
          href="/execute/inventory"
          kicker="Inventory · storeroom"
          title="Count"
          value="—"
          status="Count what's on the shelf. Variance feeds back to the numbers."
          action="Count inventory →"
        />
      </section>
    </main>
  );
}
