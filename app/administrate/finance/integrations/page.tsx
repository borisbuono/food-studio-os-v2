import Link from "next/link";
import { getBindings, AVAILABLE } from "@/lib/integrations/registry";
import type { IntegrationBinding } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

function Pill({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected: "bg-basil/10 text-basil border-basil/30",
    stub: "bg-paper-deep text-muted border-line",
    off: "bg-tomato/10 text-tomato border-tomato/30",
  };
  return <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${map[status] || map.stub}`}>{status}</span>;
}

function Cell({ binding, kind }: { binding: IntegrationBinding; kind: "pos" | "accounting" | "booking" | "payment" | "banking" }) {
  const b = binding[kind] as any;
  if (!b) return <td className="px-3 py-3 text-muted">—</td>;
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="font-serif text-[15px] text-ink">{b.vendor}</span>
        <Pill status={b.status} />
      </div>
    </td>
  );
}

export default function IntegrationsPage() {
  const bindings = getBindings();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Finance · Integrations</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">Substrate</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Every system below is a swap. Set <code>FS_POS_IFL=square</code> or <code>FS_ACCOUNTING_BM=quickbooks</code> in Vercel env to flip a vendor for one entity. The contract above the adapter doesn't change.</p>

      <section className="mt-8 rounded-2xl border border-line">
        <table className="w-full text-left">
          <thead className="border-b border-line text-[11px] font-mono uppercase tracking-wide text-clay">
            <tr><th className="px-3 py-3">Entity</th><th className="px-3 py-3">POS</th><th className="px-3 py-3">Accounting</th><th className="px-3 py-3">Booking</th><th className="px-3 py-3">Payment</th><th className="px-3 py-3">Banking</th></tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.entity} className="border-b border-line last:border-b-0">
                <td className="px-3 py-3 font-mono text-[13px] text-ink">{b.entity}</td>
                <Cell binding={b} kind="pos" /><Cell binding={b} kind="accounting" /><Cell binding={b} kind="booking" /><Cell binding={b} kind="payment" /><Cell binding={b} kind="banking" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        {(["pos","accounting","booking","payment","banking"] as const).map((k) => (
          <div key={k} className="rounded-2xl border border-line bg-paper p-5">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{k}</p>
            <ul className="mt-3 space-y-1.5">
              {AVAILABLE[k].map((a) => (
                <li key={a.vendor} className="flex items-baseline justify-between border-b border-line/60 pb-1.5 last:border-b-0">
                  <span className="font-serif text-[15px] text-ink">{a.name}</span>
                  <code className="font-mono text-[10px] text-muted">{a.vendor}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mt-10 rounded-2xl border border-line bg-paper-deep/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Env override pattern</p>
        <pre className="mt-2 overflow-auto font-mono text-[11px] text-ink-soft">{`FS_POS_IFL=square
FS_ACCOUNTING_BM=quickbooks
FS_BOOKING_IFL=opentable
FS_PAYMENT_BM=stripe
FS_BANKING_IFL=tink

# Per-vendor credentials (only set the ones you use):
SQUARE_ACCESS_TOKEN=...
QBO_CLIENT_ID=...  QBO_CLIENT_SECRET=...
OPENTABLE_API_KEY=...
STRIPE_SECRET_KEY=...
TINK_CLIENT_ID=... TINK_CLIENT_SECRET=...`}</pre>
      </section>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay"><Link href="/administrate/finance/dashboard">← back to finance</Link></p>
    </main>
  );
}
