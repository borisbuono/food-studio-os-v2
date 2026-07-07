import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Suppliers() {
  
  const supabase = supabaseServer();const providers = (await supabase.from("providers").select("id,name,category,delivery_schedule,delivery_days,cutoff_time,current_offer,notes").order("name")).data || [];
  const prods = (await supabase.from("provider_products").select("provider_id").eq("is_active", true)).data || [];
  const orders = await supabase.from("orders").select("*", { count: "exact", head: true });
  const prodCount: Record<string, number> = {};
  prods.forEach((p: any) => { prodCount[p.provider_id] = (prodCount[p.provider_id] || 0) + 1; });

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Suppliers · ordering</p>
      <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-ink">{providers.length} suppliers</h1>
      <Link href="/execute/orders/picker" className="mt-4 inline-block font-mono text-[11px] uppercase tracking-wide text-ink-soft">Find a product across all suppliers →</Link>

      <div className="mt-6 border-y border-dashed border-line py-5">
        <p className="font-sans text-[14px] text-ink-soft">{(orders.count ?? 0) === 0 ? "No orders placed through the OS yet — placing orders to suppliers arrives next." : (orders.count + " orders on record.")}</p>
      </div>

      <div className="mt-6 divide-y divide-line border-t border-line">
        {providers.map((p: any) => (
          <Link key={p.id} href={"/administrate/suppliers/" + p.id} className="block py-5 transition hover:opacity-70">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-2xl text-ink">{noEmoji(p.name)}</h2>
              <span className="font-mono text-[11px] text-clay">{prodCount[p.id] || 0} products</span>
            </div>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">{[p.category, p.delivery_schedule, p.cutoff_time ? "cutoff " + p.cutoff_time : ""].filter(Boolean).join(" · ")}</p>
            {p.current_offer ? <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">{p.current_offer}</p> : null}
          </Link>
        ))}
        {!providers.length ? <p className="font-sans text-[14px] text-clay">No suppliers yet.</p> : null}
      </div>
    </main>
  );
}
