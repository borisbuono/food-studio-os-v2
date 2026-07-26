import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";
import { SupplierChip } from "@/components/chips";

export const dynamic = "force-dynamic";

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

function daysSince(iso: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default async function Invoices() {
  
  const supabase = supabaseServer();const rid = serverRestaurantId();
  const [orders, providers, movements, history] = await Promise.all([
    supabase.from("orders").select("id,provider_id,order_date,delivery_date,delivered_at,sent_at,total,invoice_ref,channel,notes,metadata,reconciled_at,variance_notes").eq("restaurant_id", rid).order("delivery_date", { ascending: false, nullsFirst: false }).limit(120),
    supabase.from("providers").select("id,name,email,whatsapp,category"),
    supabase.from("inventory_movements").select("provider_id,occurred_at").eq("restaurant_id", rid).eq("reason", "delivery_received"),
    supabase.from("price_history").select("supplier,captured_at,source").eq("source", "invoice"),
  ]);
  const provName = new Map((providers.data || []).map((p: any) => [p.id, p.name]));
  const provComms = new Map((providers.data || []).map((p: any) => [p.id, { email: p.email, whatsapp: p.whatsapp }]));

  // Has-delivery-note signal: an inventory_movement (delivery_received) within ±2 days of delivery_date OR delivered_at
  const movementsByProv: Record<string, number[]> = {};
  (movements.data || []).forEach((m: any) => {
    if (!m.provider_id) return;
    (movementsByProv[m.provider_id] ||= []).push(new Date(m.occurred_at).getTime());
  });

  const hasDeliveryNote = (providerId: string, anchor: string | null) => {
    if (!anchor || !movementsByProv[providerId]) return false;
    const t = new Date(anchor).getTime();
    return movementsByProv[providerId].some((mt) => Math.abs(mt - t) < 2 * 86400000);
  };

  type Row = {
    kind: "missing-note" | "missing-invoice" | "stale-invoice";
    order_id: string;
    provider_id: string;
    provider_name: string;
    when: string;
    days: number;
    total: number;
    comms: any;
    note: string;
    urgent: boolean;
  };

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const rows: Row[] = [];
  (orders.data || []).forEach((o: any) => {
    const anchor = o.delivered_at || o.delivery_date || o.sent_at;
    if (!anchor) return;
    const days = daysSince(anchor);
    const noteIn = o.provider_id ? hasDeliveryNote(o.provider_id, anchor) : false;
    const comms = (o.metadata && o.metadata.comms) || null;

    if (o.delivered_at && !noteIn) {
      // Delivered but no inventory_movement = no delivery note logged
      rows.push({ kind: "missing-note", order_id: o.id, provider_id: o.provider_id, provider_name: provName.get(o.provider_id) || "unknown", when: anchor, days, total: Number(o.total || 0), comms, note: comms?.last_message || "", urgent: days >= 7 });
    } else if ((o.delivered_at || (days >= 3 && o.sent_at)) && !o.invoice_ref) {
      rows.push({ kind: "missing-invoice", order_id: o.id, provider_id: o.provider_id, provider_name: provName.get(o.provider_id) || "unknown", when: anchor, days, total: Number(o.total || 0), comms, note: comms?.last_message || "", urgent: days >= 14 });
    } else if (o.invoice_ref && !o.reconciled_at && days >= 30) {
      rows.push({ kind: "stale-invoice", order_id: o.id, provider_id: o.provider_id, provider_name: provName.get(o.provider_id) || "unknown", when: anchor, days, total: Number(o.total || 0), comms, note: o.variance_notes || "", urgent: days >= 45 });
    }
  });
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.days - a.days);

  const stuckNote = rows.filter((r) => r.kind === "missing-note").length;
  const stuckInv = rows.filter((r) => r.kind === "missing-invoice").length;
  const totalStuck = rows.reduce((a, r) => a + r.total, 0);

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← the numbers</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Missing paper · the background watcher</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What's stuck.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Delivery notes lose more often than invoices. This page shows only what wants a call — the rest runs silent.</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="border-t border-line pt-3"><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Delivery notes</p><p className="mt-1 font-serif text-2xl text-ink">{stuckNote}</p></div>
        <div className="border-t border-line pt-3"><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Invoices</p><p className="mt-1 font-serif text-2xl text-ink">{stuckInv}</p></div>
      </div>
      {rows.length ? <p className="mt-2 font-mono text-[11px] text-clay">≈ {eur(totalStuck)} of activity un-papered</p> : null}

      {rows.length === 0 ? (
        <div className="mt-10 border-t border-line pt-5">
          <p className="font-serif text-[16px] italic text-ink-soft">All clear. Every delivery has a note, every invoice is on file.</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line border-t border-line">
          {rows.map((r) => {
            const comms = provComms.get(r.provider_id);
            const kindLabel = r.kind === "missing-note" ? "delivery note" : r.kind === "missing-invoice" ? "invoice" : "stale invoice";
            const subject = encodeURIComponent("Pendiente: " + (r.kind === "missing-note" ? "albarán" : "factura") + " — " + new Date(r.when).toLocaleDateString("es-ES"));
            const body = encodeURIComponent("Hola " + r.provider_name + ",\n\nNos falta el " + (r.kind === "missing-note" ? "albarán" : "factura") + " de la entrega del " + new Date(r.when).toLocaleDateString("es-ES") + (r.total ? " (importe estimado " + eur(r.total) + ")" : "") + ". ¿Podéis enviarlo por email?\n\nGracias!");
            const mailHref = comms?.email ? "mailto:" + comms.email + "?subject=" + subject + "&body=" + body : null;
            const waHref = comms?.whatsapp ? "https://wa.me/" + String(comms.whatsapp).replace(/[^0-9]/g, "") + "?text=" + body : null;
            return (
              <li key={r.order_id} className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[17px] text-ink"><SupplierChip id={r.provider_id} name={noEmoji(r.provider_name)} /></span>
                  <span className={"font-mono text-[11px] uppercase tracking-wide " + (r.urgent ? "text-tomato" : "text-clay")}>{r.urgent ? "urgent · " : ""}{r.days}d</span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-clay">{kindLabel} · {new Date(r.when).toLocaleDateString("en-GB")}{r.total ? " · " + eur(r.total) : ""}</p>
                {r.note ? <p className="mt-1 font-serif italic text-[13px] text-ink-soft">"{r.note}"</p> : null}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {waHref ? <a href={waHref} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>chase on whatsapp →</a> : null}
                  {mailHref ? <a href={mailHref} className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>chase by email →</a> : null}
                  {!waHref && !mailHref ? <span className="font-mono text-[10px] uppercase tracking-wide text-clay">no contact on file</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">Runs silently against orders × inventory_movements × price_history · surfaces anything past its grace period</p>
    </main>
  );
}
