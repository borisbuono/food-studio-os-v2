import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Develop() {
  const menu = await supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("is_active", true);
  const recipes = await supabase.from("recipes").select("*", { count: "exact", head: true });
  const hubs = [
    { title: "Menu", items: [
      { href: "/menu", label: "Menu · " + (menu.count ?? 0) + " dishes", blurb: "Sell-and-train; tap a dish for its full hub." },
      { href: "/recipes", label: "Recipes · " + (recipes.count ?? 0), blurb: "Method, cost, story, Cook Mode." },
      { href: "/develop/lexicon", label: "Lexicon", blurb: "Ingredients, products & culture — the story layer." },
    ]},
    { title: "Pricing & engineering", items: [
      { href: "/develop/menu-engineering", label: "Menu engineering", blurb: "Stars, plowhorses, puzzles, dogs." },
      { href: "/develop/repricing", label: "Repricing", blurb: "Every dish against its target margin." },
    ]},
    { title: "Cellar & bar", items: [
      { href: "/develop/wine", label: "Wine", blurb: "The cellar — by style, by glass & bottle, with the pitch." },
      { href: "/develop/bar", label: "Bar", blurb: "Cocktails, builds and specs." },
    ]},
  ];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Develop · the craft</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Build the menu</h1>
      <div className="mt-8 space-y-8">
        {hubs.map((h) => (
          <section key={h.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-tomato">{h.title}</p>
            <div className="mt-2 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-card">
              {h.items.map((i) => (
                <Link key={i.href} href={i.href} className="block px-5 py-4 transition hover:bg-paper-deep">
                  <h2 className="font-serif text-[19px] text-ink">{i.label}</h2>
                  <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{i.blurb}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
