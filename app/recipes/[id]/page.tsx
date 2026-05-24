import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

function Row({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-black/10 pt-3 mt-4">
      <span className="font-sans text-[15px] text-ink">{k}</span>
      <span className="font-mono text-[13px]" style={{ color: accent || "#5E574E" }}>{v}</span>
    </div>
  );
}

export default async function RecipePage({ params }: { params: { id: string } }) {
  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/recipes" className="font-sans text-sm text-ink-soft">← recipes</Link>
        <p className="mt-8 font-serif text-2xl text-ink">Recipe not found.</p>
      </main>
    );
  }
  const ings: any[] = (await supabase.from("recipe_ingredients").select("name,quantity,unit,sort_order").eq("recipe_id", r.id).order("sort_order")).data || [];
  const lex: any = (await supabase.from("lexicon_dishes").select("*").eq("recipe_id", r.id).maybeSingle()).data;
  const mg = r.menu_price && r.cost_per_portion ? Math.round((1 - r.cost_per_portion / r.menu_price) * 100) : null;
  const mgColor = mg === null ? "#9B8E7E" : mg >= 60 ? "#5A6B3B" : mg >= 42 ? "#B5701C" : "#B8552E";
  const story = lex?.cultural_inspiration || lex?.history || lex?.technique_narrative || "";
  const allergens: string[] = (r.allergens as string[]) || [];
  const sec = (r.section || "").charAt(0).toUpperCase() + (r.section || "").slice(1);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/recipes" className="font-sans text-sm text-ink-soft">← recipes</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">{sec || "Recipe"}</p>
      <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">{noEmoji(r.name)}</h1>
      <p className="mt-2 font-mono text-[12px] text-clay">{(r.portions || 0) + " portions base"}{r.menu_price ? " · €" + r.menu_price + " menu" : ""}</p>

      <Link href={`/recipes/${r.id}/cook`} className="mt-6 block rounded-xl bg-ember px-6 py-4 text-center font-sans text-[15px] font-medium text-[#FCEFE7] transition hover:opacity-90">Cook mode</Link>

      {r.voice_statement ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">One-minute pitch</p>
          <p className="mt-2 font-serif italic text-[16px] leading-relaxed text-ink-soft">“{r.voice_statement}”</p>
        </div>
      ) : null}

      <Row k="Cost / portion" v={r.cost_per_portion ? "€" + Number(r.cost_per_portion).toFixed(2) : "—"} />
      {mg !== null ? <Row k="Margin" v={mg + "%"} accent={mgColor} /> : null}
      {allergens.length ? <Row k="Allergens" v={allergens.join(" · ")} /> : null}

      {r.description ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">Technique</p>
          <p className="mt-2 font-sans text-[15px] leading-relaxed text-ink-soft">{r.description}</p>
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
