import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { MenuItem } from "@/types/db";

export const dynamic = "force-dynamic";

const SECTION_ORDER = ["cold","hot","pizza","dessert","breakfast","wine","cocktail","beer","spirit","soft","nonalcoholic"];

export default async function MenuPage() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id,restaurant_id,recipe_id,name,section,price,cost,description,is_active,is_eighty_six,is_special,beverage_type")
    .eq("is_active", true);
  const items = (data ?? []) as MenuItem[];
  const bySection: Record<string, MenuItem[]> = {};
  for (const it of items) { const s = (it.section || "other").toLowerCase(); (bySection[s] = bySection[s] || []).push(it); }
  const sections = Object.keys(bySection).sort((a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99));
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">\u2190 develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Menu \u00b7 live from database</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{items.length} dishes</h1>
      {error && <p className="mt-4 font-mono text-sm text-ember">Could not load: {error.message}</p>}
      {sections.map((s) => (
        <section key={s} className="mt-10">
          <h2 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{s}</h2>
          <ul className="mt-3 divide-y divide-black/10">
            {bySection[s].map((it) => {
              const mg = it.price && it.cost ? Math.round((1 - it.cost / it.price) * 100) : null;
              return (
                <li key={it.id}>
                  <Link href={"/menu/" + it.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
                    <span className="font-serif text-lg text-ink">{it.name}</span>
                    <span className="shrink-0 font-mono text-sm text-ink-soft">{it.price ? "\u20ac" + it.price : "\u2013"}{mg !== null ? <span className="ml-2 text-olive">{mg}%</span> : null}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
