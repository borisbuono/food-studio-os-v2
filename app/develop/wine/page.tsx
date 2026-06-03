import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const ORDER = ["sparkling", "petnat", "white", "orange", "amber", "rose", "red", "to_classify"];
const LABEL: Record<string, string> = { sparkling: "Sparkling", petnat: "Pét-Nat", white: "White", orange: "Orange", amber: "Amber", rose: "Rosé", red: "Red", to_classify: "To classify" };

export default async function Wine() {
  const wines = (await supabase.from("menu_items").select("id,name,price,glass_price,bottle_price,wine_style,producer,region,vintage,is_eighty_six").eq("is_active", true).eq("category", "drink").eq("section", "wine").eq("restaurant_id", serverRestaurantId())).data || [];
  const styled = (s: string) => wines.filter((w: any) => (w.wine_style || "to_classify") === s);
  const priced = (w: any) => [w.glass_price ? "€" + w.glass_price + " glass" : null, (w.bottle_price || w.price) ? "€" + (w.bottle_price || w.price) + " bottle" : null].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Cellar · the wine list</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{wines.length} wines</h1>
      <div className="mt-3 flex gap-4 font-mono text-[11px] uppercase tracking-wide text-tomato">
        <Link href="/develop/wine/scan">+ Scan a label</Link>
        <Link href="/develop/wine/train">Train the list</Link>
        <Link href="/develop/wine/prices">Update prices</Link>
        <Link href="/administrate/finance/costs">Cost trends</Link>
      </div>

      {ORDER.filter((s) => styled(s).length).map((s) => (
        <section key={s} className="mt-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-tomato">{LABEL[s] || s}</p>
          <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
            {styled(s).map((w: any) => (
              <li key={w.id}>
                <Link href={"/develop/wine/" + w.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
                  <span>
                    <span className="font-serif text-[18px] text-ink">{noEmoji(w.name)}</span>
                    {(w.producer || w.region || w.vintage) ? <span className="ml-2 font-mono text-[11px] text-clay">{[w.producer, w.region, w.vintage].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-soft">{priced(w) || "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Coming: scan the bottle label on receiving (Vivino-style) → auto-fill producer / region / vintage / tasting + catch vintage changes · by-the-glass & Coravin freshness · sommelier training</p>
    </main>
  );
}
