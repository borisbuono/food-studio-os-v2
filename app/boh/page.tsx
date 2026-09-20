import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity, serverRestaurantId } from "@/lib/serverVenue";
import { houseSlugForEntity } from "@/lib/houses";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

// BOH pillar — back-of-house home. Kitchen craft, prep, receiving, cook mode.
// Tiles carry temporal-flow chips so the operator sees where they live in
// the daily loop vs the menu arc.
export default async function BohHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();
  const entity = serverEntity();
  const houseSlug = houseSlugForEntity(entity); // null when scope is Studio
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }); // Madrid trading date, derived ONCE
  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

  const [zonesRes, mepRes, tasksRes, albaransRes, recipesRes, menuRes, prepListRes] = await Promise.all([
    supabase.from("zones").select("id,restaurant_id").eq("restaurant_id", rid),
    supabase.from("mep_dishes").select("id,zone_id,is_active").eq("is_active", true),
    supabase.from("tasks").select("id,zone_id,frequency_rule").eq("is_active", true).eq("task_type", "cleaning"),
    supabase.from("albarans").select("id,received_at,restaurant_id").eq("restaurant_id", rid).gte("received_at", today + "T00:00:00").lt("received_at", today + "T23:59:59"),
    supabase.from("recipes").select("id"),
    supabase.from("menu_items").select("id,category,is_active").eq("restaurant_id", rid).eq("is_active", true),
    supabase.from("prep_lists").select("id,status").eq("entity_id", entity).eq("service_date", today),
  ]);

  const zoneIds = new Set((zonesRes.data || []).map((z: any) => z.id));
  const prep = (mepRes.data || []).filter((m: any) => zoneIds.has(m.zone_id)).length;
  const cleaningDue = (tasksRes.data || []).filter((t: any) => zoneIds.has(t.zone_id) && ((t.frequency_rule || "").startsWith("daily_") || t.frequency_rule === "weekly_" + weekday)).length;
  const prepRows = prepListRes.data || [];
  const prepTotal = prepRows.length;
  const prepDone = prepRows.filter((r: any) => r.status === "done").length;
  const prepHref = houseSlug ? `/h/${houseSlug}/kitchen/prep` : "/studio";
  const albarans = (albaransRes.data || []).length;
  const recipesCount = (recipesRes.data || []).length;
  const menuCount = (menuRes.data || []).length;

  // "N chefs on shift" — labor module (runway d2). Counts open shifts with
  // a kitchen-ish role for THIS entity. Free-text role means we filter on a
  // small vocabulary + fall back to "any open shift" as the top-line count.
  let chefsOnShift = 0;
  let anyoneOnShift = 0;
  try {
    const { data: openShifts } = await supabase
      .from("labor_shifts")
      .select("id, role")
      .eq("entity_id", entity)
      .is("clock_out", null)
      .not("clock_in", "is", null);
    anyoneOnShift = (openShifts || []).length;
    const kitchenRoles = new Set(["chef", "sous", "line", "pastry", "dish", "prep", "cook", "kitchen"]);
    chefsOnShift = (openShifts || []).filter((s: any) => kitchenRoles.has((s.role || "").toLowerCase())).length;
  } catch { /* pre-migration env — tile shows 0 */ }
  const clockHref = houseSlug ? `/h/${houseSlug}/clock` : "/office";

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <PillarHeader
        kicker="Kitchen · back of house"
        title="The kitchen."
        blurb="Menu, recipes, prep, deliveries, cook mode. The craft under the pass."
      />

      <section className="mt-10">
        <PillarTile
          href={clockHref}
          kicker="On shift · kitchen"
          title="Clocked in"
          value={chefsOnShift}
          status={anyoneOnShift === 0
            ? "No one clocked in yet — open the kiosk to tap in."
            : `${chefsOnShift} chef${chefsOnShift === 1 ? "" : "s"} · ${anyoneOnShift} total in the house`}
          action="Open the clock →"
          flowChip="execute"
        />
        <PillarTile
          href={prepHref}
          kicker={`Today's prep · ${today}`}
          title="Prep list"
          value={`${prepDone} / ${prepTotal}`}
          status={prepTotal === 0
            ? "Empty — generate from templates or add items."
            : prepDone === prepTotal
              ? "Everything done. Well ridden."
              : `${prepTotal - prepDone} still to build`}
          action="Open the prep list →"
          flowChip="execute"
        />
        <PillarTile
          href="/execute/pass"
          kicker="The Pass · MEP + cleaning"
          title="Pass"
          value={prep + cleaningDue}
          status={prep + cleaningDue === 0
            ? "Nothing on the list — start the day."
            : `${prep} MEP dishes · ${cleaningDue} cleaning due today`}
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
