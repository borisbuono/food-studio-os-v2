import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import PublishGrid from "./PublishGrid";

export const dynamic = "force-dynamic";

// Chef-facing surface: bulk publish/unpublish + allergen tagging for the /m
// guest menu. Lives in Develop (chef's workshop) rather than Administrate
// because publishing to the guest menu is a craft decision, not an admin one.
export default async function MenuPublishPage() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();
  const { data } = await supabase
    .from("menu_items")
    .select("id,name,section,category,price,is_active,is_eighty_six,published_to_m,allergens,dietary,name_es,name_de,description,description_es,description_de")
    .eq("restaurant_id", rid)
    .eq("is_active", true)
    .order("category")
    .order("section")
    .order("name");
  const items = (data || []) as any[];
  const publishedCount = items.filter((i) => i.published_to_m).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Publish · what guests see on the QR menu</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Menu publishing</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Toggle which items appear on <span className="font-mono not-italic">/m</span>, tag allergens, and manage dietary
        chips. Off-menu bar drinks stay off the guest menu by default — keep them requestable in the POS by leaving
        them unpublished.
      </p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-clay">
        {publishedCount} of {items.length} items published
      </p>

      <PublishGrid items={items} />
    </main>
  );
}
