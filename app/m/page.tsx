import FabHidden from "@/components/FabHidden";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const FOOD = ["breakfast", "lunch", "dinner", "specials"];
const LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", specials: "Specials" };

export default async function PublicMenu() {
  const items = (await supabase.from("menu_items").select("name,section,price,category,course,is_eighty_six").eq("is_active", true)).data || [];
  const food = items.filter((i: any) => i.category === "food" && !i.is_eighty_six);
  const drink = items.filter((i: any) => i.category === "drink" && !i.is_eighty_six);

  return (
    <main className="mx-auto max-w-lg px-8 py-16"><FabHidden />
      <h1 className="text-center font-serif text-4xl text-ink">Bistro Mondo</h1>
      <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-clay">Menu</p>

      {FOOD.filter((s) => food.some((i: any) => i.section === s)).map((s) => (
        <section key={s} className="mt-10">
          <h2 className="font-serif text-xl text-ink">{LABEL[s] || s}</h2>
          <ul className="mt-3">
            {food.filter((i: any) => i.section === s).map((i: any, n: number) => (
              <li key={n} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="font-serif text-[17px] text-ink-soft">{noEmoji(i.name)}</span>
                <span className="font-mono text-[13px] text-clay">{i.price ? "€" + i.price : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {drink.length ? (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink">Drinks</h2>
          <ul className="mt-3">
            {drink.map((i: any, n: number) => (
              <li key={n} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="font-serif text-[17px] text-ink-soft">{noEmoji(i.name)}</span>
                <span className="font-mono text-[13px] text-clay">{i.price ? "€" + i.price : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="mt-12 text-center font-mono text-[10px] uppercase tracking-wide text-clay">Food Studios</p>
    </main>
  );
}
