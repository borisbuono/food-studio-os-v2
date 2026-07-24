import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBindings } from "@/lib/integrations/registry";
import SyncCardClient from "./SyncCardClient";
import BankImportClient from "./BankImportClient";
import ConnectIntegration from "./ConnectIntegration";
import ConnectApideck from "./ConnectApideck";
import FrestoSyncCard from "./FrestoSyncCard";
import { frestoStatus } from "@/lib/integrations/pos/fresto";
import { headers } from "next/headers";
import { BillingHealthMini } from "@/components/PaymentsTile";
import CashRuleToggle from "@/components/CashRuleToggle";

export const dynamic = "force-dynamic";

const META: Record<string, { brand: string; fiscal: string; vat: string; restaurant_id?: string; gestoria: string; notes: string[] }> = {
  IFL: {
    brand: "Ibiza Food Studios", fiscal: "Ibiza Food Lab SL", vat: "Flat 10% on all sales (TPV + invoiced + events)",
    restaurant_id: "a0000000-0000-4000-8000-000000000001",
    gestoria: "Labritja (email-only from 2026-05-22)",
    notes: [
      "4× CaixaBank accounts in reality — Holded synced only 1. Use 'Import bank statement' below to load the other 3.",
      "Cash line on Fresto = end-of-day mistakes, deduct from Food (per ifl_cash_line_is_not_revenue).",
      "POS lands ONLY on CaixaBank 6484 / 57200001 (per ifl_bank_account_model).",
    ],
  },
  BM: {
    brand: "Bistro Mondo", fiscal: "Bistrot Mondo SL", vat: "Food 10% / Wine + Bar 21% / Tips 0%",
    restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
    gestoria: "Labritja (email-only from 2026-05-22)",
    notes: [
      "Operates under Alberto's licence — no own Licencia (per mondo_landlord_arrangement).",
      "APLAZAM €445/mo tax pattern, NO Mod 303, MOD.111 Q2+Q3 only (per bm_tax_payment_pattern).",
      "BM has credit + Solred cards; IFL has debit only (per entity_card_setup).",
    ],
  },
  BBH: {
    brand: "Boris Buono Holdings", fiscal: "Boris Buono Holdings SL", vat: "Holding — no operating VAT",
    gestoria: "Labritja",
    notes: [
      "9 months stale on Holded accounting per holded_accounting_gaps.",
      "Credit card not yet set up — needs a 5720xxxx PGC line.",
      "BBH → BM intercompany loan is the only material intercompany.",
    ],
  },
};

export default async function SetupEntity({ params }: { params: { entity: string } }) {
  const code = params.entity.toUpperCase();
  const m = META[code];
  if (!m) notFound();
  const sb = supabaseServer();
  const bindings = getBindings();
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "foodstudio.ai";
  const proto = h.get("x-forwarded-proto") || "https";
  const appOrigin = `${proto}://${host}`;
  const b = bindings.find((x) => x.entity === code);

  const billingRows = (await sb.from("platform_billing_status")
    .select("id,entity_code,platform,state,card_last4,last_failure_at,failure_count_30d,notes,billing_url")
    .eq("entity_code", code)
    .order("state")).data || [];

  const [{ count: invIn }, { count: invApproved }, { count: bankAll }, { count: bankUnmatched }, { count: eods }] = await Promise.all([
    sb.from("invoice_inbox").select("id", { count: "exact", head: true }).eq("entity_id", code),
    sb.from("invoice_inbox").select("id", { count: "exact", head: true }).eq("entity_id", code).eq("match_status", "approved"),
    sb.from("bank_movements").select("id", { count: "exact", head: true }).eq("entity_id", code),
    sb.from("bank_movements").select("id", { count: "exact", head: true }).eq("entity_id", code).eq("reconciled_to", "unmatched"),
    m.restaurant_id ? sb.from("eod_accounting").select("id", { count: "exact", head: true }).eq("restaurant_id", m.restaurant_id) : Promise.resolve({ count: 0 } as any),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/administrate/finance/setup" className="font-mono text-[10px] uppercase tracking-wide text-clay">← all entities</Link>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">{code}</p>
      <h1 className="mt-1 font-serif text-[34px] leading-[1.05] text-ink">{m.brand}</h1>
      <p className="mt-1 font-serif italic text-[14px] text-ink-soft">{m.fiscal}</p>

      <section className="mt-8 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Substrate</p>
        <ul className="mt-3 space-y-2 font-serif text-[15px] text-ink">
          <li><span className="text-muted">POS</span> · {b?.pos?.vendor} <Pill s={b?.pos?.status} /></li>
          <li><span className="text-muted">Accounting</span> · {b?.accounting?.vendor} <Pill s={b?.accounting?.status} /></li>
          <li><span className="text-muted">Booking</span> · {b?.booking?.vendor} <Pill s={b?.booking?.status} /></li>
          <li><span className="text-muted">Payment</span> · {b?.payment?.vendor} <Pill s={b?.payment?.status} /></li>
          <li><span className="text-muted">Banking</span> · {b?.banking?.vendor} <Pill s={b?.banking?.status} /></li>
        </ul>
        <p className="mt-3 font-mono text-[10px] text-muted">Flip any via env: <code>FS_POS_{code}=square</code>, <code>FS_ACCOUNTING_{code}=quickbooks</code>, etc.</p>
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Integrations · connect</p>
        <p className="mt-2 font-serif italic text-[13px] text-muted">Paste the API key from the vendor. The OS tests it against the vendor, encrypts it, and stores it. Keys never leave the server. Audit trail in <a className="underline" href="/administrate/chef-log">chef-log</a>.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ConnectIntegration entity={code} vendor="holded" kind="accounting" label="Holded (direct)" howto="From holded.com → Settings → Developers → API keys → Create. Copy the key that belongs to THIS entity's Holded account only." />
          <ConnectApideck entity={code} />
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted">Apideck is the primary abstraction (self-serve, supports Holded / QuickBooks / Xero / Sage). Holded direct stays as a bridge until Apideck coverage is verified.</p>
      </section>

      <FrestoSyncCard entity={code as any} status={frestoStatus(code as any)} appOrigin={appOrigin} />

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Fiscal</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 font-serif text-[14px]">
          <dt className="text-muted">VAT regime</dt><dd className="text-ink">{m.vat}</dd>
          <dt className="text-muted">Fiscal year</dt><dd className="text-ink">Calendar — FY2025 still open per fy2025_close_bank_anchored</dd>
          <dt className="text-muted">Gestoría</dt><dd className="text-ink">{m.gestoria}</dd>
        </dl>
        {m.restaurant_id ? (
          <CashRuleToggle restaurant_id={m.restaurant_id} restaurant_label={m.brand} />
        ) : (
          <p className="mt-3 border-t border-line pt-3 font-serif italic text-[13px] text-ink-soft">
            No operating restaurant — cash-line rule does not apply.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Backlog state</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Tile n={invIn || 0} sub={(invApproved || 0) + " approved"} label="invoices in inbox" />
          <Tile n={bankAll || 0} sub={(bankUnmatched || 0) + " unmatched"} label="bank movements" />
          <Tile n={eods || 0} sub="" label="EOD reports" />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Billing health</p>
        <p className="mt-2 font-serif italic text-[13px] text-muted">Which SaaS bills are landing. Anything not <span className="text-basil">healthy</span> means Boris's card is being declined for this entity's platforms — see <a className="underline" href="/administrate/finance/payments">payments →</a>.</p>
        <BillingHealthMini rows={billingRows as any} />
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Feed the backlog</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-paper p-4"><p className="font-serif text-[15px] text-ink">📷 Snap a photo</p><p className="mt-1 font-serif italic text-[13px] text-muted">Hold the Chef button (bottom-right) — camera opens, invoice / albarán / EOD is filed automatically.</p></div>
          <SyncCardClient code={code} />
          <BankImportClient code={code} />
          <ActionCard href={`/administrate/finance/eod/new`} title="Type an EOD" body="Manual entry with live 4-line VAT split. Dry-run posting by default." />
          <ActionCard href={`/administrate/finance/scans?status=open`} title="Triage invoices" body="Approve / flag / reject the inbox." />
          <ActionCard href={`/administrate/finance/reconciliation`} title="Reconcile bank" body="Match bank to invoices, sales receipts, asientos." />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-paper-deep/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Memory-anchored notes</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 font-serif text-[14px] text-ink-soft">
          {m.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </section>
    </main>
  );
}

function Pill({ s }: { s?: string }) {
  const c = s === "connected" ? "border-basil/40 bg-basil/10 text-basil" : s === "off" ? "border-tomato/40 bg-tomato/10 text-tomato" : "border-line bg-paper-deep text-muted";
  return <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${c}`}>{s || "stub"}</span>;
}
function Tile({ n, sub, label }: { n: number; sub: string; label: string }) {
  return (
    <div>
      <p className="font-serif text-[24px] text-ink">{n}</p>
      {sub ? <p className="font-mono text-[10px] text-muted">{sub}</p> : null}
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
    </div>
  );
}
function ActionCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="block rounded-xl border border-line bg-paper p-4 hover:border-ink-soft">
      <p className="font-serif text-[15px] text-ink">{title}</p>
      <p className="mt-1 font-serif italic text-[13px] text-muted">{body}</p>
    </Link>
  );
}
