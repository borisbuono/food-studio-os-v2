import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RecipeBrowser from "@/components/RecipeBrowser";

export const dynamic = "force-dynamic";

export default async function Recipes() {
  const { data } = await supabase
    .from("recipes")
    .select("id,name,section,cost_per_portion,menu_price,is_active,hero_image_url")
    .order("name");
  const recipes: any[] = (data || []).filter((r: any) => r.is_active !== false);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Recipes · the library</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{recipes.length} recipes</h1>
      <RecipeBrowser recipes={recipes as any} />
    </main>
  );
}
