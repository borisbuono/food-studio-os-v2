import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";
import EightySixToggle from "@/components/EightySixToggle";

export const dynamic = "force-dynamic";

function Row({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-black/10 pt-3 mt-4">
      <span className="font-sans text-[15px] text-ink">{k}</span>
      <span className="font-mono text-[13px]" style={{ color: accent || "#5E574E" }}>{v}</span>
    </div>
  );
}

export default async function DishHub({ params }: { params: { id: string } }) {
  const { data: item } = await supabase.from("menu_items").select("*").eq("id", params.id).maybeSingle();
  if (!item) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/menu" className="font-sans text-sm text-ink-soft">← menu</Link>
        <p className="mt-8 font-serif text-2xl text-ink">Dish not found.</p>
      </main>
    );
  }
  let recipe: any = null;
  let ings: any[] = [];
  let lex: any = null;
  if (item.recipe_id) {
    recipe = (await supabase.from("recipes").select("*").eq("id", item.recipe_id).maybeSingle()).data;
    ings = (await supabase.from("recipe_ingredients").select("name,quantity,unit,sort_order").eq("recipe_id", item.recipe_id).order("sort_order")).data || [];
    lex = (await supabase.from("lexicon_dishes").select("*").eq("recipe_id", item.recipe_id).maybeSingle()).data;
  }
  const price = item.price ?? recipe?.menu_price ?? null;
  const cost = recipe?.cost_per_portion ?? item.cost ?? null;
  const mg = price && cost ? Math.round((1 - cost / price) * 100) : null;
  const mgColor = mg === null ? "#9B8E7E" : mg >= 60 ? "#5A6B3B" : mg >= 42 ? "#B5701C" : "#B8552E";
  const mgRead = mg === null ? "add cost & price" : mg >= 60 ? "strong margin" : mg >= 42 ? "healthy" : "watch this margin";
  const story = lex?.cultural_inspiration || lex?.history || lex?.technique_narrative || recipe?.description || item.description || "";
  const pitch = recipe?.voice_statement || "";
  const allergens: string[] = (recipe?.allergens as string[]) || [];
  const sec = (item.section || "").charAt(0).toUpperCase() + (item.section || "").slice(1);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/menu" className="font-sans text-sm text-ink-soft">← menu</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">{sec || "Dish"}</p>
      <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">{noEmoji(item.name)}</h1>
      <p className="mt-2 font-mono text-[12px] text-clay">{price ? "€" + price : "no price"}{recipe ? " · " + (recipe.portions || 0) + " portions base" : " · no recipe linked yet"}</p>

      {recipe ? (
        <Link href={`/recipes/${item.recipe_id}`} className="mt-6 block rounded-xl bg-tomato px-6 py-4 text-center font-sans text-[15px] font-medium text-[#FCEFE7] transition hover:opacity-90">
          Open the recipe
        </Link>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-black/20 px-5 py-4 font-sans text-[13px] text-clay">No recipe linked to this dish yet.</div>
      )}

      <EightySixToggle id={item.id} initial={!!item.is_eighty_six} />

      <Row k="Margin" v={mg !== null ? mg + "% · " + mgRead : mgRead} accent={mgColor} />
      {cost !== null ? <Row k="Cost / portion" v={"€" + Number(cost).toFixed(2)} /> : null}
      {allergens.length ? <Row k="Allergens" v={allergens.join(" · ")} /> : null}

      {pitch ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">One-minute pitch</p>
          <p className="mt-2 font-serif italic text-[16px] leading-relaxed text-ink-soft">“{pitch}”</p>
        </div>
      ) : null}

      {story ? (
        <div className="mt-6">
          <p className="font-sans text-xs font-medium text-clay">Story</p>
          <p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-soft">{story}</p>
        </div>
      ) : null}

      {ings.length ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">Ingredients</p>
          <ul className="mt-2 divide-y divide-black/10">
            {ings.map((i: any, n: number) => (
              <li key={n} className="flex items-baseline justify-between gap-4 py-2">
                <span className="font-sans text-[15px] text-ink">{noEmoji(i.name)}</span>
                <span className="font-mono text-[13px] text-ink-soft">{i.quantity ?? ""} {i.unit ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
