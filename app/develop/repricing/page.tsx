import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + n.toFixed(2);

export default async function Repricing() {
  const items = (await supabase.from("menu_items").select("name,price,cost,target_margin_pct,computed_price,category").eq("is_active", true).eq("category", "food")).data || [];
  const rows = items.map((i: any) => {
    const price = Number(i.price || 0);
    const cost = Number(i.cost || 0);
    const margin = price && cost ? Math.round((1 - cost / price) * 100) : null;
    const target = i.target_margin_pct ? Number(i.target_margin_pct) : null;
    const suggested = cost && target ? cost / (1 - target / 100) : null;
    return { name: i.name, price, margin, target, suggested };
  });

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop" className="font-sans text-sm text-ink-soft">← develop</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Repricing</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Price against target margin</h1>

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {rows.map((r: any, i: number) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-3">
            <span className="font-serif text-[16px] text-ink">{noEmoji(r.name)}</span>
            <span className="font-mono text-[12px] text-ink-soft">
              {r.price ? eur(r.price) : "—"}{r.margin !== null ? " · " + r.margin + "%" : ""}{r.suggested ? " → " + eur(r.suggested) : ""}
            </span>
          </li>
        ))}
        {!rows.length ? <p className="py-3 font-sans text-[14px] text-clay">No dishes.</p> : null}
      </ul>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Suggested price appears once ingredient costs + target margins are loaded</p>
    </main>
  );
}
