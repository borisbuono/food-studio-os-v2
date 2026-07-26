import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import AssistantContext from "@/components/AssistantContext";
import {
  ENTITY_CODES,
  getGroupCashToday,
  getGroupRevenueMTD,
  getGroupOpenPayables,
  getNextTaxFiling,
  getGroupFilings,
  getFlagsRequiringOwner,
  getFlagCountsByEntity,
  type EntityCode,
  type Filing,
} from "@/lib/holdings/consolidator";
import { getIntercompanyFlows, countUnbookedIntercompany, type IntercompanyFlow, type FlowBookingStatus } from "@/lib/holdings/intercompany";

export const dynamic = "force-dynamic";

// ─── Formatting helpers ────────────────────────────────────────────────
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const eurOrDash = (n: number) => (n === 0 ? "—" : eur(n));
const intOrDash = (n: number) => (n === 0 ? "—" : n.toLocaleString("en-GB"));

// The three subsidiaries + parent — display metadata
const ENTITY_META: Record<EntityCode, { brand: string; fiscal: string; blurb: string }> = {
  IFL: { brand: "Ibiza Food Studios",  fiscal: "Ibiza Food Lab SL",      blurb: "Taller Sa Penya · fine dining · catering" },
  BM:  { brand: "Bistrot Mondo",        fiscal: "Bistrot Mondo SL",       blurb: "Terrace bistro · Alberto licence" },
  BBH: { brand: "Boris Buono Holdings", fiscal: "Boris Buono Holdings SL", blurb: "Parent · shareholder loans · corporate tax" },
};

// Booking-status chip color
const bookingChip: Record<FlowBookingStatus, string> = {
  bank_only: "bg-tomato/10 text-tomato border-tomato/30",
  mirror_posted: "bg-amber/15 text-ochre border-ochre/40",
  documented: "bg-basil/15 text-basil border-basil/30",
  unknown: "bg-line-soft text-clay border-line",
};

// ─── Page ──────────────────────────────────────────────────────────────
export default async function HoldingsConsole() {
  const currentEntity = serverEntity();

  const [cash, revMTD, payables, nextFiling, filings, flags, flagCounts, flows, unbooked] = await Promise.all([
    getGroupCashToday(),
    getGroupRevenueMTD(),
    getGroupOpenPayables(),
    getNextTaxFiling(),
    getGroupFilings(),
    getFlagsRequiringOwner(),
    getFlagCountsByEntity(),
    getIntercompanyFlows(),
    countUnbookedIntercompany(),
  ]);

  const daysToFiling = nextFiling ? Math.max(0, nextFiling.days_until) : null;

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12" style={{ ["--accent" as any]: "#3F4C28" /* olive — holdings */ }}>
      <AssistantContext
        context={{
          kind: "holdings_console",
          entity: "BBH",
          cash_total_eur: cash.total,
          revenue_mtd_total_eur: revMTD.total,
          open_payables_count: payables.total_count,
          open_payables_sum_eur: payables.total_sum,
          next_filing: nextFiling
            ? { modelo: nextFiling.modelo, entity: nextFiling.entity, due_date: nextFiling.due_date, days_until: nextFiling.days_until }
            : null,
          intercompany_unbooked: unbooked,
          flag_count: flags.reduce((a, f) => a + f.count, 0),
        }}
      />

      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Holdings · group console</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">The group.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Cash across every account, revenue this month, what's owed, and what's due next — one screen.
      </p>

      {/* ─── LAYER 1 · headline numbers strip ────────────────────────── */}
      <section className="mt-10 grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
        <HeadlineNumber label="Cash · group" value={eurOrDash(cash.total)} sub={cash.source === "empty" ? "no source yet" : cash.source === "bank_accounts" ? "live balances" : "from movements"} />
        <HeadlineNumber label="Revenue · MTD" value={eurOrDash(revMTD.total)} sub={revMTD.source === "empty" ? "no EOD yet this month" : revMTD.source === "eod_accounting" ? "accounting" : "reported"} />
        <HeadlineNumber label="Open payables" value={intOrDash(payables.total_count)} sub={payables.total_sum > 0 ? eur(payables.total_sum) + " pending" : "—"} />
        <HeadlineNumber
          label="Next filing"
          value={daysToFiling === null ? "—" : daysToFiling + "d"}
          sub={nextFiling ? "Modelo " + nextFiling.modelo + " · " + nextFiling.entity + " · " + nextFiling.due_date : "—"}
        />
      </section>

      {/* ─── LAYER 2 · entity strip ──────────────────────────────────── */}
      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">The subsidiaries</p>
          <p className="font-mono text-[10px] text-clay">tap to drill →</p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {ENTITY_CODES.map((ec) => {
            const meta = ENTITY_META[ec];
            const entityCash = cash.by_entity[ec] || 0;
            const entityRev = revMTD.by_entity[ec] || 0;
            const entityPayCount = payables.by_entity_count[ec] || 0;
            const entityPaySum = payables.by_entity_sum[ec] || 0;
            const entityFlags = flagCounts[ec] || 0;
            const status = entityFlags === 0 ? "green" : entityFlags <= 2 ? "amber" : "red";
            const statusStyle = status === "green" ? "bg-basil/15 text-basil" : status === "amber" ? "bg-amber/15 text-ochre" : "bg-tomato/10 text-tomato";
            const drillHref = ec === "BBH" ? "/administrate/holdings" : "/administrate/finance/dashboard";
            return (
              <Link key={ec} href={drillHref} className="block border-t border-line pt-4 hover:border-ink transition-colors">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{ec}</p>
                  <span className={"px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide " + statusStyle}>{status}</span>
                </div>
                <p className="mt-1 font-serif text-[20px] text-ink leading-tight">{meta.brand}</p>
                <p className="font-mono text-[10px] text-clay">{meta.fiscal}</p>
                <p className="mt-1 font-serif italic text-[12px] text-ink-soft">{meta.blurb}</p>

                <dl className="mt-4 grid grid-cols-2 gap-y-2">
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Cash</dt>
                  <dd className="text-right font-serif text-[15px] text-ink">{eurOrDash(entityCash)}</dd>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Rev MTD</dt>
                  <dd className="text-right font-serif text-[15px] text-ink">{eurOrDash(entityRev)}</dd>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Payables</dt>
                  <dd className="text-right font-serif text-[15px] text-ink">
                    {entityPayCount === 0 ? "—" : entityPayCount + " · " + eur(entityPaySum)}
                  </dd>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Flags</dt>
                  <dd className="text-right font-serif text-[15px] text-ink">{entityFlags === 0 ? "—" : entityFlags}</dd>
                </dl>
              </Link>
            );
          })}
        </div>
        {currentEntity !== "holdings" ? (
          <p className="mt-4 font-mono text-[10px] text-clay">Note · you're currently scoped to <span className="text-ink">{currentEntity}</span>. Drill links open in the current entity's dashboard — switch to Holdings in the top bar to browse all three.</p>
        ) : null}
      </section>

      {/* ─── LAYER 3 · intercompany flows ────────────────────────────── */}
      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Intercompany · flows</p>
          {unbooked > 0 ? (
            <p className="font-mono text-[10px] text-tomato">{unbooked} unbooked · needs mirror asiento</p>
          ) : (
            <p className="font-mono text-[10px] text-basil">all mirrored</p>
          )}
        </div>
        {flows.length === 0 ? (
          <p className="mt-4 font-serif italic text-[14px] text-ink-soft">No intercompany activity detected. When BBH lends to BM, or Taller invoices Mondo for procurement, it appears here.</p>
        ) : (
          <table className="mt-4 w-full text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wide text-clay">
                <th className="py-2 font-normal">From → To</th>
                <th className="py-2 font-normal">Kind</th>
                <th className="py-2 text-right font-normal">This month</th>
                <th className="py-2 text-right font-normal">Cumulative</th>
                <th className="py-2 font-normal">Booking</th>
                <th className="py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody className="font-sans text-[13px] text-ink">
              {flows.map((f: IntercompanyFlow, i: number) => (
                <tr key={i} className="border-b border-line-soft">
                  <td className="py-3">
                    <span className="font-mono text-[11px] text-ink">{f.from}</span>
                    <span className="mx-1 text-clay">→</span>
                    <span className="font-mono text-[11px] text-ink">{f.to}</span>
                  </td>
                  <td className="py-3 text-ink-soft">{f.kind}</td>
                  <td className="py-3 text-right font-serif">{eurOrDash(f.this_month_eur)}</td>
                  <td className="py-3 text-right font-serif">{eurOrDash(f.cumulative_eur)}</td>
                  <td className="py-3">
                    <span className={"inline-block border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide " + bookingChip[f.booking_status]}>
                      {f.booking_status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-[10px] text-clay">
                    {f.needs_mirror ? <span className="text-tomato">Call for mirror asiento</span> : <span className="text-basil">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── LAYER 4 · group filings ─────────────────────────────────── */}
      <section className="mt-12 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Filings · group compliance</p>
        {filings.length === 0 ? (
          <p className="mt-4 font-serif italic text-[14px] text-ink-soft">No filings tracked yet. Modelos land here as Labritja signs them off.</p>
        ) : (
          <table className="mt-4 w-full text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wide text-clay">
                <th className="py-2 font-normal">Modelo</th>
                <th className="py-2 font-normal">Entity</th>
                <th className="py-2 font-normal">Period</th>
                <th className="py-2 font-normal">Due</th>
                <th className="py-2 text-right font-normal">Days</th>
                <th className="py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="font-sans text-[13px] text-ink">
              {filings.slice(0, 12).map((f: Filing, i: number) => {
                const isNext = nextFiling && f.due_date === nextFiling.due_date && f.entity === nextFiling.entity && f.modelo === nextFiling.modelo;
                const daysColor = f.days_until < 0 ? "text-tomato" : f.days_until <= 14 ? "text-ochre" : "text-ink-soft";
                return (
                  <tr key={i} className={"border-b border-line-soft " + (isNext ? "bg-ochre/5" : "")}>
                    <td className="py-3"><span className="font-mono text-[11px] text-ink">{f.modelo}</span></td>
                    <td className="py-3 font-mono text-[11px] text-ink">{f.entity}</td>
                    <td className="py-3 text-ink-soft">{f.period}</td>
                    <td className="py-3 font-mono text-[11px] text-ink-soft">{f.due_date}</td>
                    <td className={"py-3 text-right font-serif " + daysColor}>
                      {f.days_until < 0 ? "overdue " + Math.abs(f.days_until) + "d" : f.days_until + "d"}
                    </td>
                    <td className="py-3 font-mono text-[10px] uppercase tracking-wide text-clay">{f.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 font-mono text-[10px] text-clay">
          Modelo 200 (annual IS) · 303 (IVA quarterly) · 111 (IRPF quarterly) · 115 (rent) · 349 (EU) · 347 (ann. suppliers) · 390 (IVA annual).
        </p>
      </section>

      {/* ─── LAYER 5 · Assistant Layer (Sprint 6) ──────────────────── */}
      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">The Brain across the group</p>
          <Link href="/administrate/holdings/console/assistant" className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5">open Assistant admin →</Link>
        </div>
      </section>

      {/* ─── LAYER 6 · advisory clients placeholder ──────────────────── */}
      <section className="mt-12 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Advisory clients</p>
        <div className="mt-4 border border-dashed border-line px-6 py-8 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">
            When Boris starts advising other groups, they appear here.
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
            Each = a separate Holdings entity — same console, different scope.
          </p>
        </div>
      </section>

      {/* ─── Flag list (bottom, if any) ─────────────────────────────── */}
      {flags.length ? (
        <section className="mt-12 border-t border-line pt-6">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Flags · owner attention</p>
          <ul className="mt-3 divide-y divide-line-soft">
            {flags.map((fl, i) => {
              const color = fl.urgency === "red" ? "text-tomato" : fl.urgency === "amber" ? "text-ochre" : "text-basil";
              return (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-sans text-[13px] text-ink">
                    <span className="font-mono text-[10px] text-clay mr-2">{fl.entity}</span>
                    {fl.kind}
                  </span>
                  <span className={"font-mono text-[12px] " + color}>{fl.count}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function HeadlineNumber({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-1 font-serif text-4xl text-ink leading-none">{value}</p>
      <p className="mt-2 font-mono text-[10px] text-ink-soft">{sub}</p>
    </div>
  );
}
