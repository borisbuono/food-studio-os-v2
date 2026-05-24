import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";
const UT = "a0000000-0000-4000-8000-000000000001";
const eur = (n: number) => "€" + n.toFixed(2);

export default async function Trial() {
  const dishes = (await supabase.from("menu_items").select("id,name,price,cost").eq("restaurant_id", UT).order("price", { ascending: false })).data || [];
  const items = (await supabase.from("inventory_items").select("unit_cost,quantity_on_hand,counted_qty").eq("restaurant_id", UT)).data || [];
  const loss = items.reduce((a: number, i: any) => {
    if (i.counted_qty == null) return a;
    const v = (Number(i.quantity_on_hand || 0) - Number(i.counted_qty || 0)) * Number(i.unit_cost || 0);
    return a + (v > 0 ? v : 0);
  }, 0);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Trial · the engine</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Restaurant Utopia</h1>
      <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">A sandbox venue with a fully costed menu, so the closed-loop engine — live food costing and theoretical-vs-actual variance — runs end to end. None of this touches Bistro Mondo or Taller.</p>

      <Link href="/administrate/finance/variance" className="mt-6 block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
        <p className="font-sans text-xs font-medium text-ochre">Variance · theoretical vs actual</p>
        <h2 className="mt-1 font-serif text-3xl text-ember">{eur(loss)} <span className="font-sans text-base text-ink-soft">unaccounted</span></h2>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">What the count says is missing versus what sales used. Tap to see by ingredient.</p>
      </Link>

      <p className="mt-8 font-mono text-[11px] uppercase tracking-wide text-clay">Menu · live food cost</p>
      <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
        {dishes.map((d: any) => {
          const fp = d.price ? Math.round((Number(d.cost || 0) / Number(d.price)) * 1000) / 10 : null;
          return (
            <li key={d.id}>
              <Link href={"/menu/" + d.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70">
                <span className="font-serif text-[18px] text-ink">{noEmoji(d.name)}</span>
                <span className="font-mono text-[12px] text-ink-soft">{eur(Number(d.price || 0))} · cost {eur(Number(d.cost || 0))}{fp != null ? " · " + fp + "%" : ""}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
