import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity, serverRestaurantId } from "@/lib/serverVenue";
import { ENTITY_LABEL } from "@/lib/entities";
import AssistantContext from "@/components/AssistantContext";

export const dynamic = "force-dynamic";

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const ENTITY_CODE: Record<string, string> = {
  taller: "IFL", bistro_mondo: "BM", holdings: "BBH",
};

export default async function FinanceDashboard() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const restaurant_id = serverRestaurantId();
  const ec = ENTITY_CODE[entity] || "IFL";

  const today = new Date().toISOString().slice(0, 10);

  const [eodToday, unapproved, bankUnmatched, openOrders, stuckPaper] = await Promise.all([
    supabase.from("eod_accounting").select("revenue,actual_covers,revenue_food,revenue_wine,revenue_bar").eq("restaurant_id", restaurant_id).eq("report_date", today).maybeSingle(),
    supabase.from("invoice_inbox").select("id,amount_eur,arrived_at,sender:provider_id(name)", { count: "exact" }).eq("entity_id", ec).not("match_status", "in", "(approved,rejected,duplicate)"),
    supabase.from("bank_movements").select("id,amount_eur,description,movement_date", { count: "exact" }).eq("entity_id", ec).eq("reconciled_to", "unmatched").order("movement_date", { ascending: false }).limit(5),
    supabase.from("orders").select("id,delivery_date,total,status,providers:provider_id(name)", { count: "exact" }).eq("restaurant_id", restaurant_id).in("status", ["sent","received"]),
    supabase.from("albarans").select("id,received_at,providers:provider_id(name)", { count: "exact" }).eq("match_status", "awaiting_invoice").order("received_at", { ascending: false }).limit(5),
  ]);

  const todayRev = Number(eodToday.data?.revenue || 0);
  const todayCov = Number(eodToday.data?.actual_covers || 0);
  const unapprovedCount = unapproved.count ?? 0;
  const unapprovedTotal = (unapproved.data || []).reduce((a: number, r: any) => a + Number(r.amount_eur || 0), 0);
  const bankCount = bankUnmatched.count ?? 0;
  const bankTotal = (bankUnmatched.data || []).reduce((a: number, r: any) => a + Math.abs(Number(r.amount_eur || 0)), 0);
  const openOrdersCount = openOrders.count ?? 0;
  const paperStuckCount = stuckPaper.count ?? 0;

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <AssistantContext context={{ kind: "finance_dashboard", entity: ec }} />
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← the numbers</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Finance · {ec} · operational</p>
      <nav aria-label="Finance sections" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-b border-line pb-3 font-mono text-[11px] uppercase tracking-wide">
        <a href="/administrate/finance/setup" className="text-ink hover:text-clay">⚙ Setup / Connect</a>
        <a href="/administrate/finance/scans" className="text-ink-soft hover:text-clay">Invoices</a>
        <a href="/administrate/finance/reconciliation" className="text-ink-soft hover:text-clay">Bank</a>
        <a href="/administrate/finance/eod" className="text-ink-soft hover:text-clay">EOD</a>
        <a href="/administrate/finance/integrations" className="text-ink-soft hover:text-clay">Substrate</a>
        <a href="/administrate/chef-log" className="text-ink-soft hover:text-clay">Chef-log</a>
      </nav>
      {/* FINANCE_NAV_INJECTED */}
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">{ENTITY_LABEL[entity]}.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Today's pulse — what moved, what's stuck, what wants you.</p>

      {/* TILE 1 — Today's revenue */}
      <section className="mt-10 border-t border-line pt-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Today · revenue</p>
        <p className="mt-1 font-serif text-5xl text-ink leading-none">{eur(todayRev)}</p>
        <p className="mt-2 font-serif text-[14px] text-ink-soft">
          {todayCov ? <>{todayCov.toLocaleString("en-GB")} covers · {eur(todayRev / Math.max(1, todayCov))} avg</> : "No EOD report yet today."}
        </p>
        {eodToday.data ? (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div><p className="font-serif text-xl text-ink">{eur(Number(eodToday.data.revenue_food || 0))}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Food</p></div>
            <div><p className="font-serif text-xl text-ink">{eur(Number(eodToday.data.revenue_wine || 0))}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Wine</p></div>
            <div><p className="font-serif text-xl text-ink">{eur(Number(eodToday.data.revenue_bar || 0))}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Bar</p></div>
          </div>
        ) : null}
        <Link href="/administrate/finance/eod" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Post today's EOD →</Link>
      </section>

      {/* TILE 2 — Unapproved Compras */}
      <section className="mt-8 border-t border-line pt-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Inbox · unapproved purchases</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="font-serif text-4xl text-ink leading-none">{unapprovedCount}</p>
          <p className="font-mono text-[12px] text-ink-soft">{unapprovedTotal > 0 ? eur(unapprovedTotal) + " pending" : "—"}</p>
        </div>
        <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
          {unapprovedCount === 0 ? "Nothing waiting. Every invoice is approved." : "Triage today's batch — duplicates, EU-VAT, intercompany flagged for you."}
        </p>
        <Link href="/administrate/finance/scans" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open triage →</Link>
      </section>

      {/* TILE 3 — Bank unmatched */}
      <section className="mt-8 border-t border-line pt-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Bank · unmatched movements</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="font-serif text-4xl text-ink leading-none">{bankCount}</p>
          <p className="font-mono text-[12px] text-ink-soft">{bankTotal > 0 ? eur(bankTotal) + " in motion" : "—"}</p>
        </div>
        {bankUnmatched.data && bankUnmatched.data.length ? (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {(bankUnmatched.data as any[]).slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-sans text-[13px] text-ink truncate">{r.description || "—"}</span>
                <span className={"font-mono text-[12px] " + (Number(r.amount_eur) >= 0 ? "text-basil" : "text-tomato")}>{Number(r.amount_eur) >= 0 ? "+" : ""}{eur(Number(r.amount_eur))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-serif italic text-[13px] text-ink-soft">No bank movements ingested yet — connect Holded Treasury to populate.</p>
        )}
        <Link href="/administrate/finance/reconciliation" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open the board →</Link>
      </section>

      {/* TILE 4 — Procurement in flight */}
      <section className="mt-8 border-t border-line pt-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Procurement · open</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="font-serif text-4xl text-ink leading-none">{openOrdersCount}</p>
          <p className="font-mono text-[12px] text-ink-soft">{paperStuckCount > 0 ? paperStuckCount + " awaiting factura" : "—"}</p>
        </div>
        <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
          {openOrdersCount === 0 ? "No orders in flight." : "Orders sent or received but not yet closed."}
        </p>
        <Link href="/administrate/suppliers" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open suppliers →</Link>
      </section>

      <p className="mt-12 font-mono text-[10px] uppercase tracking-wide text-clay">Foundation surface. POS/Holded/bank integrations layer on next.</p>
          <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay"><a href="/administrate/finance/integrations">substrate &middot; integrations →</a></p>
          <div className="mt-10 grid grid-cols-2 gap-3">
        <span className="rounded-xl border border-line bg-paper-deep px-4 py-3 text-center font-mono text-[11px] uppercase tracking-wide text-clay">📷 Hold Chef to capture</span>
        <a href="/administrate/finance/setup" className="rounded-xl border border-line bg-paper px-4 py-3 text-center font-mono text-[11px] uppercase tracking-wide text-ink">⚙ Onboard entities</a>
      </div>
    </main>
  );
}
