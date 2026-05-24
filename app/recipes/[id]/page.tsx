import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];

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
  const dish: any = (await supabase.from("menu_items").select("id").eq("recipe_id", r.id).maybeSingle()).data;

  const sec = (r.section || "").toString();
  const kicker = sec ? sec.charAt(0).toUpperCase() + sec.slice(1) : "Recipe";
  const dek = r.voice_statement || "";
  const story = lex?.cultural_inspiration || lex?.history || lex?.technique_narrative || "";
  const methodSrc = (r.description || "").trim();
  let steps: string[] = [];
  if (methodSrc) steps = (methodSrc.includes("\n") ? methodSrc.split(/\n+/) : methodSrc.split(/(?<=[.!?])\s+/)).map((s: string) => s.trim()).filter(Boolean);
  const allergens: string[] = (r.allergens as string[]) || [];

  return (
    <main className="bg-paper">
      {r.hero_image_url ? (
        <section className="relative flex min-h-[64vh] flex-col justify-between overflow-hidden px-7 pb-12 pt-14" style={{ backgroundImage: `linear-gradient(to top, rgba(16,15,12,.82), rgba(16,15,12,.25)), url(${r.hero_image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}>
          <div className="flex items-center justify-between">
            <Link href="/recipes" className="font-serif text-[16px] text-[#F2ECDE]/80">‹</Link>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#F2ECDE]/70">{r.restaurant || "Food Studios"}</span>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.32em] text-amber">{kicker}</p>
            <h1 className="font-serif text-[60px] font-light leading-[0.9] tracking-tight text-[#F2ECDE]">{noEmoji(r.name)}</h1>
            {dek ? <p className="mt-4 max-w-[320px] font-serif text-[19px] font-light italic leading-snug text-[#F2ECDE]/85">{dek}</p> : null}
          </div>
        </section>
      ) : (
        <section className="border-b border-line px-7 pb-10 pt-12">
          <div className="flex items-center justify-between">
            <Link href="/recipes" className="font-serif text-[16px] text-ink-soft">‹</Link>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-clay">{r.restaurant || "Food Studios"}</span>
          </div>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.32em] text-tomato">{kicker}</p>
          <h1 className="mt-2 font-serif text-[clamp(40px,9vw,60px)] font-light leading-[0.92] tracking-tight text-ink">{noEmoji(r.name)}</h1>
          {dek ? <p className="mt-4 max-w-[340px] font-serif text-[19px] font-light italic leading-snug text-ink-soft">{dek}</p> : null}
          <Link href={`/recipes/${r.id}/cook`} className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 font-sans text-[13px] font-medium text-paper transition hover:opacity-90">Begin cook mode</Link>
        </section>
      )}

      <div className="mx-auto max-w-xl px-7">
        {story ? (
          <section className="pt-16">
            <p className="mb-5 font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">The story</p>
            <p className="font-serif text-[21px] font-light leading-relaxed text-ink-soft">{story}</p>
          </section>
        ) : null}

        {ings.length ? (
          <section className="pt-14">
            <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Mise{r.portions ? " — for " + r.portions : ""}</p>
            <div>
              {ings.map((i: any, n: number) => (
                <div key={n} className="flex items-baseline gap-4 border-b border-line py-4 first:border-t">
                  <span className="flex-1 font-serif text-[20px] text-ink">{noEmoji(i.name)}</span>
                  <span className="font-sans text-[12.5px] tracking-wide text-clay">{i.quantity ?? ""} {i.unit ?? ""}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {steps.length ? (
          <section className="pt-14">
            <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">The making</p>
            {steps.map((s, n) => (
              <div key={n} className="grid grid-cols-[54px_1fr] gap-1.5 border-b border-line py-6">
                <span className="font-serif text-[30px] font-light italic leading-none text-tomato">{ROMAN[n] || n + 1}</span>
                <span className="font-serif text-[20px] font-light leading-snug text-ink">{s}</span>
              </div>
            ))}
          </section>
        ) : null}

        {allergens.length ? <p className="pt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-clay">Contains · {allergens.join(" · ")}</p> : null}

        <div className="py-14 text-center font-serif text-[26px] text-line">·&nbsp;&nbsp;·&nbsp;&nbsp;·</div>

        <div className="flex items-stretch gap-3 pb-16">
          <Link href={`/recipes/${r.id}/cook`} className="flex-1 rounded-sm border border-ink py-4 text-center font-serif text-[18px] font-light italic text-ink transition hover:bg-ink hover:text-paper">Begin Cook Mode</Link>
          {dish ? <Link href={`/menu/${dish.id}`} className="flex items-center rounded-sm bg-ink px-5 font-mono text-[10px] uppercase tracking-[0.2em] text-paper">Calculation</Link> : null}
        </div>
      </div>
    </main>
  );
}
