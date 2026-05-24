import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Receiving() {
  const moves = (await supabase.from("inventory_movements").select("inventory_item_id,quantity,unit,reason,movement_at").order("movement_at", { ascending: false }).limit(50)).data || [];
  const ids = Array.from(new Set(moves.map((m: any) => m.inventory_item_id).filter(Boolean)));
  const items = ids.length ? (await supabase.from("inventory_items").select("id,name").in("id", ids)).data || [] : [];
  const name = new Map(items.map((i: any) => [i.id, i.name]));

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Receiving · stock movements</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Recent movements</h1>

      <ul className="mt-8 divide-y divide-black/10 border-t border-black/10">
        {moves.map((m: any, n: number) => {
          const q = Number(m.quantity || 0);
          return (
            <li key={n} className="flex items-baseline justify-between gap-4 py-3">
              <div>
                <p className="font-serif text-[16px] text-ink">{noEmoji(name.get(m.inventory_item_id) || "Item")}</p>
                <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{m.reason || "movement"}{m.movement_at ? " · " + String(m.movement_at).slice(0, 10) : ""}</p>
              </div>
              <span className={"font-mono text-[13px] " + (q >= 0 ? "text-olive" : "text-ember")}>{q >= 0 ? "+" : ""}{q} {m.unit || ""}</span>
            </li>
          );
        })}
        {!moves.length ? <p className="py-3 font-sans text-[14px] text-clay">No stock movements recorded yet.</p> : null}
      </ul>
    </main>
  );
}
