"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Prov = { id: string; name: string; category: string | null; whatsapp: string | null; email: string | null; cutoff_time: string | null; delivery_schedule: string | null };
type Prod = { id: string; provider_id: string; name: string; price: number | null; unit: string | null };

const eur = (n: number) => "€" + n.toFixed(2);

export default function Order() {
  const [providers, setProviders] = useState<Prov[]>([]);
  const [products, setProducts] = useState<Prod[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<"build" | "review" | "send" | "sent">("build");
  const [sentVia, setSentVia] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<any[] | null>(null);

  useEffect(() => {
    (async () => {
      const [p, pp] = await Promise.all([
        supabase.from("providers").select("id,name,category,whatsapp,email,cutoff_time,delivery_schedule").order("name"),
        supabase.from("provider_products").select("id,provider_id,name,price,unit").eq("is_active", true).order("name"),
      ]);
      setProviders(p.data || []);
      setProducts(pp.data || []);
      setLoading(false);
      try { const dr = localStorage.getItem("fs_order_draft"); if (dr) setDraft(JSON.parse(dr)); } catch {}
    })();
  }, []);

  const provider = providers.find((p) => p.id === sel) || null;
  const provProducts = useMemo(() => products.filter((p) => p.provider_id === sel), [products, sel]);
  const setQty = (id: string, q: number) => setCart((c) => { const n = { ...c }; if (q <= 0) delete n[id]; else n[id] = q; return n; });
  const lines = Object.entries(cart).map(([id, q]) => { const pr = products.find((p) => p.id === id); return { id, name: pr?.name || "", unit: pr?.unit, price: pr?.price ?? 0, qty: q, total: (pr?.price ?? 0) * q }; });
  const total = lines.reduce((a, l) => a + l.total, 0);

  const orderMessage = () => {
    const head = `Hola${provider?.name ? " " + provider.name : ""} — pedido / order:`;
    const body = lines.map((l) => `• ${l.qty} × ${noEmoji(l.name)}${l.unit ? " (" + l.unit + ")" : ""}`).join("\n");
    const tail = [provider?.delivery_schedule ? "Entrega/Delivery: " + provider.delivery_schedule : "", "Gracias!"].filter(Boolean).join("\n");
    return [head, "", body, "", tail].join("\n");
  };
  const logOrder = async (channel: string) => {
    try {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null)) || "utopia";
      const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      await supabaseBrowser.from("orders").insert({ restaurant_id: rid, provider_id: provider?.id || null, created_by: p?.id || null, status: "sent", channel, sent_at: new Date().toISOString(), order_date: new Date().toISOString().slice(0, 10), subtotal: total, total, notes: orderMessage() });
    } catch {}
  };
  const sendVia = async (channel: "whatsapp" | "email", url: string) => { await logOrder(channel); setSentVia(channel); window.open(url, "_blank"); setStage("sent"); };

  if (loading) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Loading suppliers…</p></main>;

  if (stage === "send") {
    const message = orderMessage();
    const wa = provider?.whatsapp ? "https://wa.me/" + provider.whatsapp.replace(/[^0-9]/g, "") + "?text=" + encodeURIComponent(message) : null;
    const mail = provider?.email ? "mailto:" + provider.email + "?subject=" + encodeURIComponent("Order — Food Studios") + "&body=" + encodeURIComponent(message) : null;
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <button onClick={() => setStage("review")} className="font-sans text-sm text-ink-soft">← back</button>
        <p className="mt-6 font-sans text-xs font-medium text-ochre">Send · {noEmoji(provider?.name || "")}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Send the order</h1>
        <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">This opens your own WhatsApp or email with the order written out — you tap send. We log it as sent here so it shows in Receiving.</p>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-black/10 bg-card p-4 font-sans text-[14px] leading-relaxed text-ink">{message}</pre>
        <div className="mt-4 flex flex-col gap-3">
          {wa ? <button onClick={() => sendVia("whatsapp", wa)} className="w-full rounded-xl bg-ochre px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">Send on WhatsApp</button> : null}
          {mail ? <button onClick={() => sendVia("email", mail)} className="w-full rounded-xl border border-black/20 px-6 py-4 font-sans text-[15px] text-ink">Send by email</button> : null}
          {!wa && !mail ? <p className="font-sans text-[14px] text-clay">No WhatsApp or email on file for this supplier — add one on the supplier card.</p> : null}
          <button onClick={() => { navigator.clipboard?.writeText(message); }} className="w-full rounded-xl border border-black/15 px-6 py-3 font-mono text-[11px] uppercase tracking-wide text-ink-soft">Copy the message</button>
        </div>
      </main>
    );
  }

  if (stage === "sent") {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-sans text-xs font-medium text-ochre">Order</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Order sent to {noEmoji(provider?.name || "")}</h1>
        <p className="mt-3 font-sans text-[15px] leading-relaxed text-ink-soft">{lines.length} lines · {eur(total)} · opened in {sentVia === "email" ? "your email" : "WhatsApp"} for you to hit send. Logged here as sent — it’ll appear in Receiving and Invoices.</p>
        <button onClick={() => { setCart({}); setSel(null); setSentVia(null); setStage("build"); }} className="mt-6 rounded-xl bg-ochre px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]">Start another order</button>
      </main>
    );
  }

  if (stage === "review") {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <button onClick={() => setStage("build")} className="font-sans text-sm text-ink-soft">← edit order</button>
        <p className="mt-6 font-sans text-xs font-medium text-ochre">Review · {noEmoji(provider?.name || "")}</p>
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
        <button onClick={() => setStage("send")} className="mt-6 w-full rounded-xl bg-ochre px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">Send order →</button>
      </main>
    );
  }

  // build stage
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/suppliers" className="font-sans text-sm text-ink-soft">← suppliers</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">New order</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{provider ? noEmoji(provider.name) : "Choose a supplier"}</h1>

      {draft && draft.length ? (
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--accent)" }}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>Assistant draft</p>
          <ul className="mt-1">
            {draft.map((d: any, i: number) => <li key={i} className="font-serif text-[15px] text-ink">{d.qty} {d.unit} · {noEmoji(String(d.name || ""))}</li>)}
          </ul>
          <p className="mt-2 font-sans text-[12px] text-ink-soft">Pick the supplier below and add the matching products — these are the assistant's suggested lines, ready to confirm.</p>
          <button onClick={() => { localStorage.removeItem("fs_order_draft"); setDraft(null); }} className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">dismiss</button>
        </div>
      ) : null}

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
          <button onClick={() => { setSel(null); setCart({}); }} className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ochre">change supplier</button>
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
          <button onClick={() => setStage("review")} className="flex w-full items-center justify-between rounded-xl bg-ochre px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">
            <span>Review order</span>
            <span className="font-mono text-[13px]">{lines.length} lines · {eur(total)}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
