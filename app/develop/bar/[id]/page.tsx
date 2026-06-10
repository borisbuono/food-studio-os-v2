import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function CocktailHub({ params }: { params: { id: string } }) {
  
  const supabase = supabaseServer();const c: any = (await supabase.from("menu_items").select("*").eq("id", params.id).maybeSingle()).data;
  if (!c) return <main className="mx-auto max-w-xl px-6 py-12"><Link href="/develop/bar" className="font-sans text-sm text-ink-soft">← bar</Link><p className="mt-8 font-serif text-2xl text-ink">Cocktail not found.</p></main>;
  const build = (c.build || c.description || "").trim();
  return (
    <main className="mx-auto max-w-xl px-7 py-12">
      <Link href="/develop/bar" className="font-sans text-sm text-ink-soft">← bar</Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">Cocktail</p>
      <h1 className="mt-2 font-serif text-4xl font-light leading-tight text-ink">{noEmoji(c.name)}</h1>
      <p className="mt-2 font-mono text-[12px] text-clay">{c.price ? "€" + c.price : "no price"}</p>

      {build ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">The build</p>
          <p className="mt-2 whitespace-pre-line font-serif text-[19px] font-light leading-relaxed text-ink">{build}</p>
        </div>
      ) : <p className="mt-7 font-sans text-[14px] text-clay">No build recorded yet — add the spec so anyone behind the bar can make it consistently.</p>}

      <div className="mt-8 rounded-2xl border border-dashed border-black/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-tomato">Coming to the bar module</p>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">Per-cocktail cost & margin, and bar stock by weighing bottles — full-bottle weight minus current weight gives exact remaining pour. The most precise way to count a bar.</p>
      </div>
    </main>
  );
}
