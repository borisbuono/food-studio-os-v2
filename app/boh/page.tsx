import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

// BOH pillar — back-of-house home. Kitchen craft, prep, receiving, cook mode.
// Tiles carry temporal-flow chips so the operator sees where they live in
// the daily loop vs the menu arc.
export default async function BohHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

  const [zonesRes, mepRes, tasksRes, albaransRes, recipesRes, menuRes] = await Promise.all([
    supabase.from("zones").select("id,restaurant_id").eq("restaurant_id", rid),
    supabase.from("mep_dishes").select("id,zone_id,is_active").eq("is_active", true),
    supabase.from("tasks").select("id,zone_id,frequency_rule").eq("is_active", true).eq("task_type", "cleaning"),
    supabase.from("albarans").select("id,received_at,restaurant_id").eq("restaurant_id", rid).gte("received_at", today + "T00:00:00").lt("received_at", today + "T23:59:59"),
    supabase.from("recipes").select("id"),
    supabase.from("menu_items").select("id,category,is_active").eq("restaurant_id", rid).eq("is_active", true),
  ]);

  const zoneIds = new Set((zonesRes.data || []).map((z: any) => z.id));
  const prep = (mepRes.data || []).filter((m: any) => zoneIds.has(m.zone_id)).length;
  const cleaningDue = (tasksRes.data || []).filter((t: any) => zoneIds.has(t.zone_id) && ((t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday)).length;
  const albarans = (albaransRes.data || []).length;
  const recipesCount = (recipesRes.data || []).length;
  const menuCount = (menuRes.data || []).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <PillarHeader
        kicker="BOH · back of house"
        title="The kitchen."
        blurb="Menu, recipes, prep, deliveries, cook mode. The craft under the pass."
      />

      <section className="mt-10">
        <PillarTile
          href="/execute/pass"
          kicker="The Pass · prep + cleaning"
          title="Prep"
          value={prep + cleaningDue}
          status={prep + cleaningDue === 0
            ? "Nothing on the list — start the day."
            : `${prep} prep · ${cleaningDue} cleaning due today`}
          action="Open the pass →"
          flowChip="execute"
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
          flowChip="execute"
        />
        <PillarTile
          href="/execute/orders"
          kicker="Orders · to suppliers"
          title="Order"
          value="—"
          status="Draft an order for tomorrow — pull from templates + par levels."
          action="Draft an order →"
          flowChip="execute"
        />
        <PillarTile
          href="/develop/menu"
          kicker="Menu · food + drinks"
          title="Menu"
          value={menuCount}
          status={menuCount === 0
            ? "No live items — build tonight's specials."
            : `${menuCount} live item${menuCount === 1 ? "" : "s"} on the menu`}
          action="Open the menu →"
          flowChip="develop"
        />
        <PillarTile
          href="/menu"
          kicker="Recipes · library"
          title="Recipes"
          value={recipesCount}
          status={recipesCount === 0
            ? "The recipe library is empty — start with tonight's specials."
            : `${recipesCount} recipe${recipesCount === 1 ? "" : "s"} in the library — costed, scaled, ready to Cook`}
          action="Browse recipes →"
          flowChip="develop"
        />
        <PillarTile
          href="/execute/inventory"
          kicker="Inventory · storeroom"
          title="Count"
          value="—"
          status="Count what's on the shelf. Variance feeds back to the numbers."
          action="Count inventory →"
          flowChip="execute"
        />
        <PillarTile
          href="/boh/academy"
          kicker="Academy · kitchen craft"
          title="Training"
          value="—"
          status="HACCP, temperatures, cross-contamination, mise. One lesson a day."
          action="Open training →"
          flowChip="admin"
        />
      </section>
    </main>
  );
}
