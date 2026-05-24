"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

type Prov = { id: string; name: string; category: string | null; whatsapp: string | null; email: string | null; cutoff_time: string | null; delivery_schedule: string | null };
type Prod = { id: string; provider_id: string; name: string; price: number | null; unit: string | null };

const eur = (n: number) => "€" + n.toFixed(2);

export default function Order() {
  const [providers, setProviders] = useState<Prov[]>([]);
  const [products, setProducts] = useState<Prod[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<"build" | "review" | "sent">("build");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [p, pp] = await Promise.all([
        supabase.from("providers").select("id,name,category,whatsapp,email,cutoff_time,delivery_schedule").order("name"),
        supabase.from("provider_products").select("id,provider_id,name,price,unit").eq("is_active", true).order("name"),
      ]);
      setProviders(p.data || []);
      setProducts(pp.data || []);
      setLoading(false);
    })();
  }, []);

  const provider = providers.find((p) => p.id === sel) || null;
  const provProducts = useMemo(() => products.filter((p) => p.provider_id === sel), [products, sel]);
  const setQty = (id: string, q: number) => setCart((c) => { const n = { ...c }; if (q <= 0) delete n[id]; else n[id] = q; return n; });
  const lines = Object.entries(cart).map(([id, q]) => { const pr = products.find((p) => p.id === id); return { id, name: pr?.name || "", unit: pr?.unit, price: pr?.price ?? 0, qty: q, total: (pr?.price ?? 0) * q }; });
  const total = lines.reduce((a, l) => a + l.total, 0);

  if (loading) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Loading suppliers…</p></main>;

  if (stage === "sent") {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-sans text-xs font-medium text-ember">Order</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Draft ready for {noEmoji(provider?.name || "")}</h1>
        <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">{lines.length} lines · {eur(total)}. Sending to suppliers (via {provider?.whatsapp ? "WhatsApp" : provider?.email ? "email" : "their channel"}) connects with your confirm step — nothing has actually been sent.</p>
        <button onClick={() => { setCart({}); setSel(null); setStage("build"); }} className="mt-6 rounded-xl bg-ember px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]">Start another order</button>
      </main>
    );
  }

  if (stage === "review") {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <button onClick={() => setStage("build")} className="font-sans text-sm text-ink-soft">← edit order</button>
        <p className="mt-6 font-sans text-xs font-medium text-ember">Review · {noEmoji(provider?.name || "")}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">{lines.length} lines · {eur(total)}</h1>
        <ul className="mt-6 divide-y divide-black/10 border-y border-black/10">
          {lines.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-4 py-3">
              <span className="font-serif text-[16px] text-ink">{l.qty} × {noEmoji(l.name)}{l.unit ? " (" + l.unit + ")" : ""}</span>
              <span className="font-mono text-[12px] text-ink-soft">{l.price ? eur(l.total) : "—"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[11px] text-clay">{[provider?.delivery_schedule, provider?.cutoff_time ? "cutoff " + provider.cutoff_time : ""].filter(Boolean).join(" · ")}</p>
        <button onClick={() => setStage("sent")} className="mt-6 w-full rounded-xl bg-ember px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">Prepare to send</button>
      </main>
    );
  }

  // build stage
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/suppliers" className="font-sans text-sm text-ink-soft">← suppliers</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">New order</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{provider ? noEmoji(provider.name) : "Choose a supplier"}</h1>

      {!provider ? (
        <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
          {providers.map((p) => (
            <li key={p.id}>
              <button onClick={() => setSel(p.id)} className="flex w-full items-baseline justify-between gap-4 py-3 text-left transition hover:opacity-70">
                <span className="font-serif text-[17px] text-ink">{noEmoji(p.name)}</span>
                <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{p.category || ""}</span>
              </button>
            </li>
          ))}
          {!providers.length ? <p className="py-3 font-sans text-[14px] text-clay">No suppliers yet.</p> : null}
        </ul>
      ) : (
        <>
          <button onClick={() => { setSel(null); setCart({}); }} className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ember">change supplier</button>
          <ul className="mt-5 divide-y divide-black/10 border-t border-black/10">
            {provProducts.map((p) => {
              const q = cart[p.id] || 0;
              return (
                <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-serif text-[16px] text-ink">{noEmoji(p.name)}</p>
                    <p className="font-mono text-[11px] text-clay">{[p.price ? eur(p.price) : null, p.unit].filter(Boolean).join(" / ") || "—"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setQty(p.id, q - 1)} className="h-8 w-8 rounded-full border border-black/15 font-mono text-ink-soft">–</button>
                    <span className="w-6 text-center font-mono text-[14px] text-ink">{q}</span>
                    <button onClick={() => setQty(p.id, q + 1)} className="h-8 w-8 rounded-full border border-black/15 font-mono text-ink-soft">+</button>
                  </div>
                </li>
              );
            })}
            {!provProducts.length ? <p className="py-3 font-sans text-[14px] text-clay">No products listed for this supplier yet.</p> : null}
          </ul>
        </>
      )}

      {lines.length ? (
        <div className="sticky bottom-4 mt-6">
          <button onClick={() => setStage("review")} className="flex w-full items-center justify-between rounded-xl bg-ember px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">
            <span>Review order</span>
            <span className="font-mono text-[13px]">{lines.length} lines · {eur(total)}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
