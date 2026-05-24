import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

function clip(s: string, n = 180) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }

function Entry({ title, meta, body }: { title: string; meta?: string; body?: string }) {
  return (
    <div className="border-t border-black/10 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-[19px] text-ink">{title}</h3>
        {meta ? <span className="font-mono text-[11px] text-clay">{meta}</span> : null}
      </div>
      {body ? <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{body}</p> : null}
    </div>
  );
}

export default async function Lexicon() {
  const dishes = (await supabase.from("lexicon_dishes").select("recipe_id,cultural_inspiration,history,technique_narrative,pairing_notes")).data || [];
  const recIds = dishes.map((d: any) => d.recipe_id).filter(Boolean);
  const recs = recIds.length ? (await supabase.from("recipes").select("id,name").in("id", recIds)).data || [] : [];
  const recName = new Map(recs.map((r: any) => [r.id, r.name]));
  const ings = (await supabase.from("lexicon_ingredients").select("name,region,story,season_start,season_end")).data || [];
  const prods = (await supabase.from("lexicon_products").select("name,producer,region,vintage,story")).data || [];
  const culture = (await supabase.from("lexicon_culture").select("title,category,body")).data || [];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Lexicon · the story layer</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The knowledge behind the craft</h1>

      {dishes.length ? (
        <section className="mt-8">
          <p className="font-sans text-xs font-medium text-clay">Dishes</p>
          {dishes.map((d: any, i: number) => (
            <Entry key={i} title={noEmoji(recName.get(d.recipe_id) || "Untitled dish")} body={clip(d.cultural_inspiration || d.history || d.technique_narrative || d.pairing_notes || "")} />
          ))}
        </section>
      ) : null}

      {prods.length ? (
        <section className="mt-8">
          <p className="font-sans text-xs font-medium text-clay">Products & wine</p>
          {prods.map((p: any, i: number) => (
            <Entry key={i} title={noEmoji(p.name)} meta={[p.producer, p.region, p.vintage].filter(Boolean).join(" · ")} body={clip(p.story || "")} />
          ))}
        </section>
      ) : null}

      {ings.length ? (
        <section className="mt-8">
          <p className="font-sans text-xs font-medium text-clay">Ingredients</p>
          {ings.map((p: any, i: number) => (
            <Entry key={i} title={noEmoji(p.name)} meta={[p.region, (p.season_start && p.season_end) ? p.season_start + "–" + p.season_end : ""].filter(Boolean).join(" · ")} body={clip(p.story || "")} />
          ))}
        </section>
      ) : null}

      {culture.length ? (
        <section className="mt-8">
          <p className="font-sans text-xs font-medium text-clay">Culture</p>
          {culture.map((c: any, i: number) => (
            <Entry key={i} title={noEmoji(c.title || "Untitled")} meta={c.category || ""} body={clip(c.body || "")} />
          ))}
        </section>
      ) : null}

      {!dishes.length && !prods.length && !ings.length && !culture.length ? (
        <p className="mt-8 font-sans text-[14px] text-clay">No lexicon entries yet.</p>
      ) : null}
    </main>
  );
}
