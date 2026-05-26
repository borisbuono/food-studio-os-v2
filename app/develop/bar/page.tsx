import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Bar() {
  const cocktails = (await supabase.from("menu_items").select("id,name,price,build").eq("is_active", true).eq("category", "drink").eq("section", "cocktail").eq("restaurant_id", serverRestaurantId()).order("name")).data || [];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Bar · the cocktails</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{cocktails.length} cocktails</h1>

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {cocktails.map((c: any) => (
          <li key={c.id}>
            <Link href={"/develop/bar/" + c.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
              <span className="font-serif text-[18px] text-ink">{noEmoji(c.name)}</span>
              <span className="shrink-0 font-mono text-[12px] text-ink-soft">{c.price ? "€" + c.price : "—"}{c.build ? "" : " · no build yet"}</span>
            </Link>
          </li>
        ))}
        {!cocktails.length ? <p className="py-3 font-sans text-[14px] text-clay">No cocktails on the list yet.</p> : null}
      </ul>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Bar stock by weighing bottles (full-weight → remaining) arrives next</p>
    </main>
  );
}
