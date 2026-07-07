import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

// Architecture v2 — the Develop pillar landing.
// Four tiles, same shape as Execute / Administrate / Grow.
export default async function DevelopHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();

  const [menuRes, recipesRes, wineRes, priceRes] = await Promise.all([
    supabase.from("menu_items").select("id,category,is_active").eq("restaurant_id", rid).eq("is_active", true),
    supabase.from("recipes").select("id"),
    supabase.from("menu_items").select("id,category,beverage_type,is_active").eq("restaurant_id", rid).eq("is_active", true).eq("beverage_type", "wine"),
    // recent supplier price moves in the last 30 days — a repricing signal
    supabase.from("price_history").select("name,unit_price,captured_at").gte("captured_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(500),
  ]);

  const menuCount = (menuRes.data || []).length;
  const recipesCount = (recipesRes.data || []).length;
  const wineCount = (wineRes.data || []).length;

  // Count how many products moved > ±5% in the last 30 days
  const byName: Record<string, any[]> = {};
  (priceRes.data || []).forEach((r: any) => {
    if (!r.name) return;
    (byName[r.name] ||= []).push(r);
  });
  let bigMovers = 0;
  Object.values(byName).forEach((rows: any[]) => {
    if (rows.length < 2) return;
    const sorted = rows.slice().sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    const latest = Number(sorted[0].unit_price || 0);
    const earliest = Number(sorted[sorted.length - 1].unit_price || 0);
    if (!earliest) return;
    const pct = Math.abs((latest - earliest) / earliest) * 100;
    if (pct >= 5) bigMovers++;
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <PillarHeader
        kicker="Develop · the craft"
        title="Menu, recipes, calculation."
        blurb="What goes on the menu, what it costs, what it tastes like. Ingredient → recipe → sale."
      />

      <section className="mt-10">
        <PillarTile
          href="/develop/menu-engineering"
          kicker="Menu engineering · profit + popularity"
          title="Menu"
          value={menuCount}
          status={menuCount === 0
            ? "No active menu items — build the first dish."
            : `${menuCount} live item${menuCount === 1 ? "" : "s"} sorted by profit and popularity`}
          action="Open menu engineering →"
        />
        <PillarTile
          href="/recipes"
          kicker="Recipes · library"
          title="Recipes"
          value={recipesCount}
          status={recipesCount === 0
            ? "The recipe library is empty — start with tonight's specials."
            : `${recipesCount} recipe${recipesCount === 1 ? "" : "s"} in the library — costed, scaled, ready to Cook`}
          action="Browse recipes →"
        />
        <PillarTile
          href="/develop/wine"
          kicker="Wine · list"
          title="Wine"
          value={wineCount}
          status={wineCount === 0
            ? "No wines on the list yet — scan a bottle to add."
            : `${wineCount} wines across the list — by style and region`}
          action="Open the wine list →"
        />
        <PillarTile
          href="/develop/repricing"
          kicker="Repricing · signals"
          title="Repricing"
          value={bigMovers}
          status={bigMovers === 0
            ? "Prices stable this month — no repricing needed."
            : `${bigMovers} ingredient${bigMovers === 1 ? "" : "s"} moved ≥5% in the last 30 days`}
          action="Review repricing →"
        />
      </section>
    </main>
  );
}
