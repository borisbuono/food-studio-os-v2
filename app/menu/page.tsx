import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import type { MenuItem } from "@/types/db";

export const dynamic = "force-dynamic";

const FOOD_ORDER = ["breakfast", "lunch", "dinner", "specials"];
const DRINK_ORDER = ["coffee_tea", "soft", "wine", "beer", "cocktail", "spirit"];
const WINE_ORDER = ["sparkling", "petnat", "white", "orange", "amber", "rose", "red", "to_classify"];
const SECTION_LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", specials: "Specials", coffee_tea: "Coffee & Tea", soft: "Soft & Non-alcoholic", wine: "Wine", beer: "Beer", cocktail: "Cocktails", spirit: "Spirits" };
const WINE_LABEL: Record<string, string> = { sparkling: "Sparkling", petnat: "Pét-Nat", white: "White", orange: "Orange", amber: "Amber", rose: "Rosé", red: "Red", to_classify: "To classify" };
const COURSE_LABEL: Record<string, string> = { starter: "Starter", main: "Main", side: "Side", dessert: "Dessert" };

function Item({ it }: { it: MenuItem }) {
  const mg = it.price && it.cost ? Math.round((1 - (it.cost as number) / (it.price as number)) * 100) : null;
  return (
    <li>
      <Link href={"/menu/" + it.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
        <span className="font-serif text-lg text-ink">
          {noEmoji(it.name)}
          {it.is_eighty_six ? <span className="ml-2 rounded bg-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-soft">86</span> : null}
          {it.course ? <span className="ml-2 font-sans text-[11px] uppercase tracking-wide text-clay">{COURSE_LABEL[it.course] || it.course}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-sm text-ink-soft">{it.price ? "€" + it.price : "–"}{mg !== null ? <span className="ml-2 text-olive">{mg}%</span> : null}</span>
      </Link>
    </li>
  );
}

export default async function MenuPage() {
  
  const supabase = supabaseServer();const { data } = await supabase
    .from("menu_items")
    .select("id,restaurant_id,recipe_id,name,section,price,cost,description,is_active,is_eighty_six,is_special,beverage_type,category,course,wine_style")
    .eq("is_active", true).neq("restaurant_id", "a0000000-0000-4000-8000-000000000001");
  const items = (data ?? []) as MenuItem[];
  // Library: recipes with no linked menu item (sub-recipes, prep)
  const linkedRecipeIds = new Set(items.map((i) => i.recipe_id).filter(Boolean));
  const recRes = await supabase.from("recipes").select("id,name,section").order("name");
  const library = ((recRes.data || []) as any[]).filter((r) => !linkedRecipeIds.has(r.id));
  const food = items.filter((i) => i.category === "food");
  const drink = items.filter((i) => i.category === "drink");
  const inSection = (arr: MenuItem[], s: string) => arr.filter((i) => (i.section || "") === s);

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Dishes · the menu and the library</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{items.length} items</h1>
      <a href="/m" className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wide text-tomato">Guest menu →</a>

      <h2 className="mt-12 font-serif text-2xl text-ink">Food</h2>
      {FOOD_ORDER.filter((s) => inSection(food, s).length).map((s) => (
        <section key={s} className="mt-7">
          <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{SECTION_LABEL[s] || s}</h3>
          <ul className="mt-2 divide-y divide-black/10">{inSection(food, s).map((it) => <Item key={it.id} it={it} />)}</ul>
        </section>
      ))}

      <h2 className="mt-14 font-serif text-2xl text-ink">Drinks</h2>
      {DRINK_ORDER.filter((s) => inSection(drink, s).length).map((s) => {
        const si = inSection(drink, s);
        if (s === "wine") {
          return (
            <section key={s} className="mt-7">
              <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">Wine</h3>
              {WINE_ORDER.filter((ws) => si.some((i) => (i.wine_style || "") === ws)).map((ws) => (
                <div key={ws} className="mt-4">
                  <p className="font-serif italic text-[15px] text-ink-soft">{WINE_LABEL[ws] || ws}</p>
                  <ul className="mt-1 divide-y divide-black/10">{si.filter((i) => (i.wine_style || "") === ws).map((it) => <Item key={it.id} it={it} />)}</ul>
                </div>
              ))}
            </section>
          );
        }
        return (
          <section key={s} className="mt-7">
            <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{SECTION_LABEL[s] || s}</h3>
            <ul className="mt-2 divide-y divide-black/10">{si.map((it) => <Item key={it.id} it={it} />)}</ul>
          </section>
        );
      })}

      {library.length > 0 ? (
        <section className="mt-14">
          <h2 className="font-serif text-2xl text-ink">Library</h2>
          <p className="mt-1 font-sans text-[13px] text-ink-soft">Sub-recipes and prep that aren't on the menu yet. {library.length} in total.</p>
          <ul className="mt-3 divide-y divide-black/10">
            {library.map((r: any) => (
              <li key={r.id}>
                <Link href={"/develop/menu/" + r.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
                  <span className="font-serif text-lg text-ink">{r.name}</span>
                  {r.section ? <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{r.section}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
