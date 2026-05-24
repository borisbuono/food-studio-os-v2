import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Recipes() {
  const { data } = await supabase.from("recipes").select("id,name,section,cost_per_portion,menu_price,is_active").order("name");
  const recipes: any[] = (data || []).filter((r: any) => r.is_active !== false);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Recipes · the library</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{recipes.length} recipes</h1>
      <ul className="mt-8 divide-y divide-black/10">
        {recipes.map((r: any) => {
          const mg = r.menu_price && r.cost_per_portion ? Math.round((1 - r.cost_per_portion / r.menu_price) * 100) : null;
          return (
            <li key={r.id}>
              <a href={"/recipes/" + r.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
                <span className="font-serif text-lg text-ink">{noEmoji(r.name)}</span>
                <span className="shrink-0 font-mono text-[13px] text-ink-soft">{r.cost_per_portion ? "€" + Number(r.cost_per_portion).toFixed(2) : "–"}{mg !== null ? <span className="ml-2 text-olive">{mg}%</span> : null}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
