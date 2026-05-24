import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Invoices() {
  const orders = (await supabase.from("orders").select("id,provider_id,order_date,total,invoice_ref,delivered_at").order("order_date", { ascending: false }).limit(50)).data || [];
  const missing = orders.filter((o: any) => o.delivered_at && !o.invoice_ref);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← finance</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Missing invoices</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Deliveries without an invoice</h1>

      {missing.length ? (
        <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
          {missing.map((o: any, i: number) => (
            <li key={i} className="flex items-baseline justify-between py-3">
              <span className="font-sans text-[15px] text-ink">{o.order_date}</span>
              <span className="font-mono text-[12px] text-ochre">no invoice</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 font-sans text-[15px] leading-relaxed text-ink-soft">No flagged gaps. The detector matches Holded deliveries against received invoices and lists anything missing — it lights up once Holded is synced to v2 and orders flow through the system.</p>
      )}
    </main>
  );
}
