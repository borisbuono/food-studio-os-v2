import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

// FOH pillar — front-of-house home. Six tiles covering the service front.
// Each tile carries a temporal-flow chip so the operator sees where it lives
// in the day/menu/guest arcs.
//
// Canonical routes are linked directly (not aliases) so the URL bar shows the
// real path; aliases exist for muscle-memory (/foh/pass etc.) and redirect
// here.
export default async function FohHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartIso = monthStart.toISOString();

  const [bookingsRes, menuRes, guestsRes, reviewsRes] = await Promise.all([
    supabase.from("bookings").select("id,party_size,status,service_date").eq("restaurant_id", rid).eq("service_date", today),
    supabase.from("menu_items").select("id,is_active").eq("restaurant_id", rid).eq("is_active", true),
    supabase.from("guests").select("id,created_at").eq("restaurant_id", rid),
    supabase.from("guest_feedback").select("id,created_at,sentiment").eq("restaurant_id", rid).gte("created_at", monthStartIso),
  ]);

  const bookings = (bookingsRes.data || []).filter((b: any) => !["cancelled", "no_show"].includes((b.status || "").toLowerCase()));
  const coversBooked = bookings.reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);
  const menuCount = (menuRes.data || []).length;
  const guestsAll = guestsRes.data || [];
  const guestCount = guestsAll.length;
  const newThisMonth = guestsAll.filter((g: any) => g.created_at && g.created_at >= monthStartIso).length;
  const reviewsMonth = (reviewsRes.data || []).length;

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <PillarHeader
        kicker="FOH · front of house"
        title="Serve the room."
        blurb="Bookings, the pass, the menu, guests, reviews. Everything on the service floor."
      />

      <section className="mt-10">
        <PillarTile
          href="/execute/pass"
          kicker="Tonight · the pass"
          title="The Pass"
          value={coversBooked || "—"}
          status={coversBooked === 0
            ? "No covers booked yet — the pass will fill as reservations arrive."
            : `${coversBooked} covers · ${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
          action="Open the pass →"
          flowChip="execute"
        />
        <PillarTile
          href="/execute/floor"
          kicker="Service · floor plan"
          title="Floor"
          value={bookings.length}
          status={bookings.length === 0
            ? "No bookings yet — the room is quiet."
            : `${bookings.length} table${bookings.length === 1 ? "" : "s"} to seat tonight`}
          action="Open the floor →"
          flowChip="execute"
        />
        <PillarTile
          href="/develop/menu"
          kicker="Menu · food + drinks"
          title="Menu"
          value={menuCount}
          status={menuCount === 0
            ? "The menu is empty — ask the kitchen for tonight's specials."
            : `${menuCount} live item${menuCount === 1 ? "" : "s"} — food + bar`}
          action="Browse the menu →"
          flowChip="develop"
        />
        <PillarTile
          href="/grow/relationships"
          kicker="Guests · profiles"
          title="Guests"
          value={guestCount}
          status={guestCount === 0
            ? "No guest profiles yet — start with tonight's regulars."
            : `${guestCount} guest${guestCount === 1 ? "" : "s"} on file · ${newThisMonth} new this month`}
          action="Open guests →"
          flowChip="grow"
        />
        <PillarTile
          href="/grow/reputation"
          kicker="Reviews · this month"
          title="Reviews"
          value={reviewsMonth}
          status={reviewsMonth === 0
            ? "No reviews yet this month."
            : `${reviewsMonth} feedback signal${reviewsMonth === 1 ? "" : "s"} logged this month`}
          action="Read reviews →"
          flowChip="grow"
        />
        <PillarTile
          href="/foh/academy"
          kicker="Academy · service craft"
          title="Training"
          value="—"
          status="Service flow, wine pairings, guest recognition — one lesson at a time."
          action="Open training →"
          flowChip="admin"
        />
      </section>
    </main>
  );
}
