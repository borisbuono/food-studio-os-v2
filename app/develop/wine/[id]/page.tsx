import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function WineHub({ params }: { params: { id: string } }) {
  
  const supabase = supabaseServer();const w: any = (await supabase.from("menu_items").select("*").eq("id", params.id).maybeSingle()).data;
  if (!w) return <main className="mx-auto max-w-xl px-6 py-12"><Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link><p className="mt-8 font-serif text-2xl text-ink">Wine not found.</p></main>;

  const lex: any = (await supabase.from("lexicon_products").select("story,why_chosen,pairing_dishes,producer,region,vintage").ilike("name", w.name).maybeSingle()).data;
  const producer = w.producer || lex?.producer;
  const region = w.region || lex?.region;
  const vintage = w.vintage || lex?.vintage;
  const story = lex?.story || lex?.why_chosen || w.description || "";

  // Per-wine cost trend
  const history = (await supabase.from("price_history")
    .select("unit_price,captured_at,supplier")
    .eq("item_kind", "wine")
    .eq("item_id", w.id)
    .order("captured_at", { ascending: true })
    .limit(40)).data || [];

  const points = history.map((h: any) => ({ x: new Date(h.captured_at).getTime(), y: Number(h.unit_price) }));
  let move: { pct: number; up: boolean; from: number; to: number; supplier: string } | null = null;
  if (points.length >= 2) {
    const first = points[0].y;
    const last = points[points.length - 1].y;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    move = { pct, up: pct > 0, from: first, to: last, supplier: history[history.length - 1].supplier };
  }

  // Sparkline path
  let path = "";
  if (points.length >= 2) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs), xN = Math.max(...xs), y0 = Math.min(...ys), yN = Math.max(...ys);
    const sx = (v: number) => 4 + ((v - x0) / Math.max(1, xN - x0)) * 192;
    const sy = (v: number) => 36 - ((v - y0) / Math.max(0.0001, yN - y0)) * 28;
    path = points.map((p, i) => (i === 0 ? "M" : "L") + sx(p.x).toFixed(1) + " " + sy(p.y).toFixed(1)).join(" ");
  }

  return (
    <main className="mx-auto max-w-xl px-7 py-12">
      <Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">{(w.wine_style || "wine").replace("_", " ")}</p>
      <h1 className="mt-2 font-serif text-4xl font-light leading-tight text-ink">{noEmoji(w.name)}</h1>
      <p className="mt-2 font-mono text-[12px] text-clay">{[producer, region, vintage].filter(Boolean).join(" · ") || "details to add"}</p>

      <div className="mt-6 grid grid-cols-2 gap-6 border-y border-line py-5">
        <div><p className="font-serif text-3xl text-ink">{w.glass_price ? "€" + w.glass_price : "—"}</p><p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">By the glass</p></div>
        <div><p className="font-serif text-3xl text-ink">{(w.bottle_price || w.price) ? "€" + (w.bottle_price || w.price) : "—"}</p><p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">By the bottle</p></div>
      </div>

      {/* Cost trend — react-to signal, lives where you are */}
      {points.length >= 2 ? (
        <div className="mt-7 border-y border-line py-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-sans text-xs font-medium text-clay">Cost trend</p>
            {move ? <span className={"font-mono text-[12px] " + (move.up ? "text-tomato" : "text-basil")}>{move.up ? "+" : "−"}{Math.abs(move.pct).toFixed(1)}%</span> : null}
          </div>
          <svg viewBox="0 0 200 40" className="mt-2 w-full"><path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" className="text-tomato" /></svg>
          {move ? <p className="mt-1 font-sans text-[11px] leading-snug text-ink-soft">€{move.from.toFixed(2)} → €{move.to.toFixed(2)} ({move.supplier}). {Math.abs(move.pct) >= 8 ? "Big move — re-price the glass or call the supplier." : "Within normal."}</p> : null}
        </div>
      ) : null}

      {w.pitch ? (
        <div className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">One minute to present</p>
          <p className="mt-2 font-serif text-[18px] font-light italic leading-relaxed text-ink-soft">{w.pitch}</p>
        </div>
      ) : null}
      {w.tasting_notes ? (
        <div className="mt-6"><p className="font-sans text-xs font-medium text-clay">Tasting</p><p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-soft">{w.tasting_notes}</p></div>
      ) : null}
      {story ? (
        <div className="mt-6"><p className="font-sans text-xs font-medium text-clay">Story</p><p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-soft">{story}</p></div>
      ) : null}

      <div className="mt-8 grid grid-cols-3 gap-2">
        <span className="rounded-xl border border-line px-3 py-3 text-center font-sans text-[12px] text-clay">Hold Chef · scan</span>
        <Link href="/develop/wine/train" className="rounded-xl border border-line px-3 py-3 text-center font-sans text-[12px] text-ink">Train list</Link>
        <Link href="/develop/wine/prices" className="rounded-xl border border-line px-3 py-3 text-center font-sans text-[12px] text-ink">From invoice</Link>
      </div>
    </main>
  );
}
