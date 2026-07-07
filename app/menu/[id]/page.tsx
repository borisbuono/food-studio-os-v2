import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import EightySixToggle from "@/components/EightySixToggle";
import SoftRecipeCost from "@/components/SoftRecipeCost";

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
  
  const supabase = supabaseServer();const { data: item } = await supabase.from("menu_items").select("*").eq("id", params.id).maybeSingle();
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
    ings = (await supabase.from("recipe_ingredients").select("name,quantity,unit,sort_order,line_cost").eq("recipe_id", item.recipe_id).order("sort_order")).data || [];
    lex = (await supabase.from("lexicon_dishes").select("*").eq("recipe_id", item.recipe_id).maybeSingle()).data;
  }
  // menu-engineering position, folded onto the dish itself (no separate engineering screen)
  let mePos: { label: string; nudge: string; color: string } | null = null;
  if (item.category === "food") {
    const sibs = (await supabase.from("menu_items").select("units_sold").eq("restaurant_id", item.restaurant_id).eq("category", "food").eq("is_active", true)).data || [];
    const sold = sibs.map((x: any) => Number(x.units_sold || 0)).sort((a: number, b: number) => a - b);
    const med = sold.length ? sold[Math.floor(sold.length / 2)] : 0;
    const popular = Number(item.units_sold || 0) >= med && med > 0;
    const _p = item.price ?? recipe?.menu_price ?? null;
    const _c = recipe?.cost_per_portion ?? item.cost ?? null;
    const goodMargin = _p && _c ? (1 - _c / _p) >= 0.55 : null;
    if (goodMargin !== null && med > 0) {
      if (popular && goodMargin) mePos = { label: "Star", nudge: "Protect it — keep it visible and consistent.", color: "#5A6B3B" };
      else if (popular && !goodMargin) mePos = { label: "Plowhorse", nudge: "Sells well, thin margin — nudge the price or trim the cost.", color: "#B5701C" };
      else if (!popular && goodMargin) mePos = { label: "Puzzle", nudge: "Great margin, slow seller — reposition or push it.", color: "#B5701C" };
      else mePos = { label: "Dog", nudge: "Low on both — rework or retire it.", color: "#B8552E" };
    }
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
      {mePos ? <div className="mt-3 rounded-xl border border-line bg-card px-4 py-2.5"><span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: mePos.color }}>{mePos.label}</span><span className="ml-2 font-sans text-[13px] text-ink-soft">{mePos.nudge}</span></div> : null}

      {recipe ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link href={`/recipes/${item.recipe_id}`} className="rounded-xl bg-tomato px-4 py-4 text-center font-sans text-[14px] font-medium text-[#F7F7F4] transition hover:opacity-90">
            Open the recipe
          </Link>
          <Link href={`/recipes/${item.recipe_id}/cook`} className="rounded-xl border border-black/15 bg-card px-4 py-4 text-center font-sans text-[14px] text-ink transition hover:border-line">
            Cook Mode
          </Link>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-black/20 px-5 py-4 font-sans text-[13px] text-clay">No recipe linked to this dish yet.</div>
      )}

      <EightySixToggle id={item.id} initial={!!item.is_eighty_six} />

      {(() => {
        const plate = ings.reduce((a: number, i: any) => a + Number(i.line_cost || 0), 0);
        if (!plate) {
          if (!item.recipe_id) {
            return <SoftRecipeCost id={item.id} initialCost={item.cost ?? null} initialBasis={item.cost_basis ?? null} price={price != null ? Number(price) : null} />;
          }
          return (<>
            <Row k="Margin" v={mg !== null ? mg + "% · " + mgRead : mgRead} accent={mgColor} />
            {cost !== null ? <Row k="Cost / portion" v={"€" + Number(cost).toFixed(2)} /> : null}
          </>);
        }
        const fp = price ? Math.round((plate / Number(price)) * 1000) / 10 : null;
        const marg = price != null ? Number(price) - plate : null;
        return (
          <div className="mt-6 rounded-2xl border border-line bg-card p-6">
            <p className="font-sans text-xs font-medium text-ink-soft">Calculation · per portion</p>
            <ul className="mt-3 divide-y divide-black/10">
              {ings.filter((i: any) => Number(i.line_cost) > 0).map((i: any, n: number) => (
                <li key={n} className="flex items-baseline justify-between gap-4 py-1.5 font-mono text-[12.5px]">
                  <span className="text-ink-soft">{noEmoji(i.name)} · {i.quantity}{i.unit}</span>
                  <span className="text-ink">€{Number(i.line_cost).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-black/20 pt-3 font-serif text-[16px] text-ink"><span>Food cost</span><span>€{plate.toFixed(2)}</span></div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div><p className="font-serif text-xl text-ink">{price != null ? "€" + Number(price).toFixed(2) : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Price</p></div>
              <div><p className={"font-serif text-xl " + (fp != null && fp <= 32 ? "text-olive" : "text-ink-soft")}>{fp != null ? fp + "%" : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Food cost</p></div>
              <div><p className="font-serif text-xl text-ink">{marg != null ? "€" + marg.toFixed(2) : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Margin</p></div>
            </div>
          </div>
        );
      })()}
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
