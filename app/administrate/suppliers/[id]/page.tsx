import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function SupplierHub({ params }: { params: { id: string } }) {
  
  const supabase = supabaseServer();const { data: p } = await supabase.from("providers").select("*").eq("id", params.id).maybeSingle();
  if (!p) redirect("/administrate/suppliers");

  const products = (await supabase
    .from("provider_products")
    .select("id,name,unit,unit_price,pack_size,is_active")
    .eq("provider_id", params.id)
    .eq("is_active", true)
    .order("name")).data || [];

  const orders = (await supabase
    .from("orders")
    .select("id,status,channel,total,sent_at,received_at,notes")
    .eq("provider_id", params.id)
    .order("sent_at", { ascending: false })
    .limit(15)).data || [];

  // recent price moves for this supplier across all kinds
  const prices = (await supabase
    .from("price_history")
    .select("name,unit,unit_price,captured_at,item_kind")
    .eq("supplier", p.name)
    .order("captured_at", { ascending: false })
    .limit(120)).data || [];

  // group prices by product name to compute last-move + per-product latest pct for the catalog
  const productMove: Record<string, { pct: number; latest: number }> = {};
  const byProductName: Record<string, any[]> = {};
  prices.forEach((row: any) => {
    const k = (row.name || "").toLowerCase();
    if (!byProductName[k]) byProductName[k] = [];
    byProductName[k].push(row);
  });
  Object.entries(byProductName).forEach(([k, rows]) => {
    const sorted = (rows as any[]).sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    if (sorted.length >= 2 && Number(sorted[sorted.length - 1].unit_price) > 0) {
      const pct = ((Number(sorted[0].unit_price) - Number(sorted[sorted.length - 1].unit_price)) / Number(sorted[sorted.length - 1].unit_price)) * 100;
      productMove[k] = { pct, latest: Number(sorted[0].unit_price) };
    }
  });
  const byName: Record<string, any[]> = {};
  prices.forEach((row: any) => {
    if (!byName[row.name]) byName[row.name] = [];
    byName[row.name].push(row);
  });
  const moves = Object.entries(byName).map(([name, rows]) => {
    const sorted = rows.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    const latest = sorted[0];
    const prior = sorted[1];
    const pct = prior && Number(prior.unit_price) > 0 ? ((Number(latest.unit_price) - Number(prior.unit_price)) / Number(prior.unit_price)) * 100 : null;
    return { name, latest, prior, pct };
  }).filter((m) => m.pct !== null).sort((a, b) => Math.abs((b.pct as number)) - Math.abs((a.pct as number))).slice(0, 6);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/suppliers" className="font-sans text-sm text-ink-soft">← suppliers</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Supplier · {p.category || "supplier"}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{noEmoji(p.name)}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">
        {[p.delivery_schedule, p.cutoff_time ? "cutoff " + p.cutoff_time : "", p.whatsapp ? "wa " + p.whatsapp : "", p.email ? p.email : ""].filter(Boolean).join(" · ")}
      </p>

      {p.current_offer ? (
        <div className="mt-5 rounded-2xl border border-ochre/30 bg-line p-5">
          <p className="font-sans text-[14px] leading-relaxed text-ink-soft">{p.current_offer}</p>
        </div>
      ) : null}

      {/* the three actions this surface absorbs */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link href={"/execute/orders?supplier=" + p.id} className="rounded-xl bg-[color:var(--accent)] px-4 py-3 text-center font-sans text-[14px] font-medium text-[#F7F7F4]">Place an order</Link>
        <Link href="/execute/pass#receiving" className="rounded-xl border border-line bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Receive delivery</Link>
        <Link href="/administrate/finance/costs" className="rounded-xl border border-line bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Cost trends →</Link>
        {p.category === "wine" ? (
          <span className="rounded-xl border border-line bg-card px-4 py-3 text-center font-sans text-[14px] text-clay">Hold Chef to scan a label</span>
        ) : (
          <Link href={"/administrate/finance/scans?supplier=" + p.id} className="rounded-xl border border-line bg-card px-4 py-3 text-center font-sans text-[14px] text-ink">Invoices ({p.name})</Link>
        )}
      </div>

      {/* price moves — react-to signals */}
      {moves.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink">Recent price moves</h2>
          <p className="mt-1 font-sans text-[13px] text-ink-soft">From your invoices. Big moves usually want a call or a switch.</p>
          <div className="mt-3 space-y-2">
            {moves.map((m, i) => {
              const pct = m.pct as number;
              const up = pct > 0;
              return (
                <div key={i} className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
                  <div>
                    <p className="font-sans text-[14px] text-ink">{m.name}</p>
                    <p className="font-mono text-[11px] text-clay">€{Number(m.latest.unit_price).toFixed(2)}/{m.latest.unit}</p>
                  </div>
                  <span className={"font-mono text-[12px] " + (up ? "text-rose-700" : "text-emerald-700")}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* products this supplier carries */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-xl text-ink">{products.length} products</h2>
          <Link href={"/administrate/suppliers/" + params.id + "/add-product"} className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">+ add</Link>
        </div>
        {!products.length ? <p className="mt-2 font-sans text-[14px] text-clay">No catalog yet. Build it from your last invoice.</p> : (
          <ul className="mt-3 divide-y divide-black/5 rounded-2xl border border-line bg-card">
            {products.slice(0, 30).map((pr: any) => {
              const k = (pr.name || "").toLowerCase();
              const mv = productMove[k];
              return (
                <li key={pr.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <span className="font-sans text-[14px] text-ink">{noEmoji(pr.name)}</span>
                  <span className="font-mono text-[11px] text-ink-soft">
                    {pr.unit_price ? "€" + Number(pr.unit_price).toFixed(2) + "/" + pr.unit : pr.unit}
                    {mv && Math.abs(mv.pct) >= 2 ? (
                      <span className={"ml-2 " + (mv.pct > 0 ? "text-tomato" : "text-basil")}>{mv.pct > 0 ? "▲" : "▼"} {Math.abs(mv.pct).toFixed(0)}%</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* last orders */}
      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink">Last orders</h2>
        {!orders.length ? <p className="mt-2 font-sans text-[14px] text-clay">No orders placed through the OS yet.</p> : (
          <ul className="mt-3 space-y-2">
            {orders.map((o: any) => (
              <li key={o.id} className="rounded-xl border border-line bg-card px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-sans text-[13px] text-ink">{o.sent_at ? new Date(o.sent_at).toLocaleDateString("en-GB") : "draft"} · {o.channel || "—"}</span>
                  <span className="font-mono text-[11px] text-clay">{o.total ? "€" + Number(o.total).toFixed(2) : ""}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">{o.status}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
