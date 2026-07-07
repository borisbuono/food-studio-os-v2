"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { noEmoji } from "@/lib/text";

type Match = { product_id: string; name: string; unit: string | null; unit_price: number | null; provider_id: string; provider_name: string };

const eur = (n: number) => "€" + n.toFixed(2);

export default function Picker() {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [pp, prv] = await Promise.all([
        supabase.from("provider_products").select("id,provider_id,name,unit,unit_price,price,is_active").eq("is_active", true),
        supabase.from("providers").select("id,name"),
      ]);
      setProducts((pp.data || []).map((r: any) => ({ ...r, unit_price: r.unit_price ?? r.price ?? null })));
      setProviders(Object.fromEntries((prv.data || []).map((r: any) => [r.id, r.name])));
      setLoading(false);
    })();
  }, []);

  const matches: Match[] = useMemo(() => {
    if (!q.trim() || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    return products
      .filter((r) => (r.name || "").toLowerCase().includes(needle))
      .map((r) => ({
        product_id: r.id,
        name: r.name,
        unit: r.unit,
        unit_price: r.unit_price,
        provider_id: r.provider_id,
        provider_name: providers[r.provider_id] || "Unknown",
      }))
      .sort((a, b) => (a.unit_price ?? 1e9) - (b.unit_price ?? 1e9));
  }, [q, products, providers]);

  const cheapest = matches[0];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/suppliers" className="font-sans text-sm text-ink-soft">← suppliers</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Find a product · across all suppliers</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What are you looking for?</h1>
      <p className="mt-2 font-serif text-[14px] italic text-ink-soft">Tomatoes, gambas, parmesan — type it. See who's got it, at what price, pick the best.</p>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. tomato"
        className="mt-6 w-full border-b border-line bg-transparent py-3 font-serif text-2xl text-ink placeholder:text-clay focus:outline-none focus:border-ink"
      />

      {loading ? (
        <p className="mt-8 font-sans text-[14px] text-clay">Loading the catalog…</p>
      ) : !q.trim() ? (
        <p className="mt-8 font-sans text-[14px] text-clay">Start typing to search across {products.length} products from {Object.keys(providers).length} suppliers.</p>
      ) : matches.length === 0 ? (
        <p className="mt-8 font-sans text-[14px] text-clay">No supplier carries "{q}" yet. Add it to a supplier — Administrate → Suppliers → tap a supplier → + Add.</p>
      ) : (
        <>
          {cheapest && cheapest.unit_price ? (
            <div className="mt-8 border-t border-line pt-5">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Best price</p>
              <p className="mt-1 font-serif text-2xl text-ink">{noEmoji(cheapest.name)} · {eur(cheapest.unit_price)}{cheapest.unit ? " / " + cheapest.unit : ""}</p>
              <p className="font-serif text-[14px] italic text-ink-soft">at {cheapest.provider_name}</p>
              <Link href={"/execute/orders?supplier=" + cheapest.provider_id} className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open an order with them →</Link>
            </div>
          ) : null}

          <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">All matches · {matches.length}</p>
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {matches.map((m, i) => (
              <li key={i} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[16px] text-ink">{noEmoji(m.name)}</span>
                  <span className="font-mono text-[12px] text-ink">{m.unit_price ? eur(m.unit_price) : "—"}{m.unit ? " / " + m.unit : ""}</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{m.provider_name}</span>
                  <Link href={"/execute/orders?supplier=" + m.provider_id} className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>order →</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
