import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function WineHub({ params }: { params: { id: string } }) {
  const w: any = (await supabase.from("menu_items").select("*").eq("id", params.id).maybeSingle()).data;
  if (!w) return <main className="mx-auto max-w-xl px-6 py-12"><Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link><p className="mt-8 font-serif text-2xl text-ink">Wine not found.</p></main>;
  const lex: any = (await supabase.from("lexicon_products").select("story,why_chosen,pairing_dishes,producer,region,vintage").ilike("name", w.name).maybeSingle()).data;
  const producer = w.producer || lex?.producer;
  const region = w.region || lex?.region;
  const vintage = w.vintage || lex?.vintage;
  const story = lex?.story || lex?.why_chosen || "";

  return (
    <main className="mx-auto max-w-xl px-7 py-12">
      <Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">{(w.wine_style || "wine").replace("_", " ")}</p>
      <h1 className="mt-2 font-serif text-4xl font-light leading-tight text-ink">{noEmoji(w.name)}</h1>
      <p className="mt-2 font-mono text-[12px] text-clay">{[producer, region, vintage].filter(Boolean).join(" · ") || "details to add"}</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-black/10 bg-card p-5"><p className="font-serif text-2xl text-ink">{w.glass_price ? "€" + w.glass_price : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">By the glass</p></div>
        <div className="rounded-2xl border border-black/10 bg-card p-5"><p className="font-serif text-2xl text-ink">{(w.bottle_price || w.price) ? "€" + (w.bottle_price || w.price) : "—"}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">By the bottle</p></div>
      </div>

      {w.pitch ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">One minute to present</p>
          <p className="mt-2 font-serif text-[18px] font-light italic leading-relaxed text-ink-soft">“{w.pitch}”</p>
        </div>
      ) : null}
      {w.tasting_notes ? (
        <div className="mt-6"><p className="font-sans text-xs font-medium text-clay">Tasting</p><p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-soft">{w.tasting_notes}</p></div>
      ) : null}
      {story ? (
        <div className="mt-6"><p className="font-sans text-xs font-medium text-clay">Story</p><p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-soft">{story}</p></div>
      ) : null}

      <div className="mt-8 rounded-2xl border border-dashed border-black/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-tomato">Coming to the wine module</p>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">Scan the label on receiving (Vivino-style) to auto-fill producer, region, vintage and tasting notes — and flag a vintage change so it gets re-costed and re-noted, never sold as the old year. Plus open-bottle / Coravin freshness and a sommelier-training mode.</p>
      </div>
    </main>
  );
}
