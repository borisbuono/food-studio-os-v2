import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  
  const supabase = supabaseServer();const venues = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const perVenue = await Promise.all((venues as any[]).map((v: any) => supabase.from("inventory_items").select("restaurant_id,name,unit,quantity_on_hand,reorder_threshold").eq("restaurant_id", v.id).order("name")));
  const items = perVenue.flatMap((r: any) => r.data || []);

  const isLow = (i: any) => i.quantity_on_hand != null && i.reorder_threshold != null && Number(i.quantity_on_hand) <= Number(i.reorder_threshold);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Inventory</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{items.length.toLocaleString("en-GB")} items on file</h1>

      {venues.map((v: any) => {
        const mine = items.filter((i: any) => i.restaurant_id === v.id);
        const low = mine.filter(isLow);
        if (!mine.length) return null;
        return (
          <section key={v.id} className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
              <span className="font-mono text-[11px] text-clay">{mine.length} items · {low.length} low</span>
            </div>
            {low.length ? (
              <ul className="mt-3 divide-y divide-black/10 border-t border-black/10">
                {low.slice(0, 40).map((i: any, n: number) => (
                  <li key={n} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="font-sans text-[15px] text-ink">{noEmoji(i.name)}</span>
                    <span className="font-mono text-[12px] text-basil">{i.quantity_on_hand}/{i.reorder_threshold} {i.unit || ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 font-sans text-[14px] text-clay">Nothing below reorder threshold.</p>
            )}
          </section>
        );
      })}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Showing items below reorder level · full count edit arrives with stock-take</p>
    </main>
  );
}
