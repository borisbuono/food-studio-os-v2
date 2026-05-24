import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Develop() {
  const menu = await supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("is_active", true);
  const recipes = await supabase.from("recipes").select("*", { count: "exact", head: true });
  const cards = [
    { href: "/menu", kicker: "Menu", title: (menu.count ?? 0) + " dishes", blurb: "The sell-and-train page. Tap a dish for its full hub." },
    { href: "/recipes", kicker: "Recipes", title: (recipes.count ?? 0) + " recipes", blurb: "The library — method, cost, story behind each dish." },
    { href: "/develop/lexicon", kicker: "Lexicon", title: "The story layer", blurb: "Dishes, ingredients, products & culture — the knowledge behind the craft." },
    { href: "/develop/repricing", kicker: "Repricing", title: "Price vs margin", blurb: "Every dish against its target margin." },
    { href: "/develop/menu-engineering", kicker: "Menu engineering", title: "Stars & dogs", blurb: "Every dish by margin × popularity." },
  ];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Develop · the craft</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Build the menu</h1>
      <div className="mt-8 space-y-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-tomato/40">
            <p className="font-sans text-xs font-medium text-tomato">{c.kicker}</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">{c.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{c.blurb}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
