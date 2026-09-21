import { PortfolioHeader, Stat, SectionTitle, Pill, EmptyLive } from "@/components/portfolio/PortfolioChrome";
import { UnlinkedEntities } from "@/components/portfolio/UnlinkedEntities";
import {
  requireStudioAccess, isDemo, loadContracts, contractParty, madridToday,
  shortDate, relDays, eur, expiryInfo, monthLabel, type Contract,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

// /studio/partners — partner network (task #34).
//
// Joint ventures · revenue share · contracts. Revenue-share lines are the
// monthly statements; "outstanding" = statements with no settled_on date.

const PATH = "/studio/partners";
const KIND_LABEL: Record<string, string> = {
  joint_venture: "Joint venture",
  revenue_share: "Revenue share",
  licence: "Licence",
  catering: "Catering",
  other: "Other",
};

type ShareRow = { contract_id: string; period_month: string; gross_eur: number; share_eur: number; settled_on: string | null };

function terms(c: Contract): string {
  const bits: string[] = [];
  if (c.equity_pct != null) bits.push(`${Number(c.equity_pct)}% equity`);
  if (c.revenue_share_pct != null) bits.push(`${Number(c.revenue_share_pct)}% of revenue`);
  if (c.fee_eur != null) bits.push(`${eur(c.fee_eur)}${c.fee_cadence && c.fee_cadence !== "one_off" ? ` / ${c.fee_cadence.replace("ly", "")}` : ""}`);
  return bits.join(" · ") || "—";
}

export default async function StudioPartnersPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { sb, ctx, entityIds } = await requireStudioAccess();
  const demo = isDemo(searchParams);
  const today = madridToday();

  const contracts = await loadContracts(sb, ["joint_venture", "revenue_share", "licence", "catering", "other"], demo, entityIds);
  const ids = contracts.map((c) => c.id);
  const { data: sRows } = ids.length
    ? await sb.from("portfolio_revenue_share_lines").select("contract_id,period_month,gross_eur,share_eur,settled_on").in("contract_id", ids).order("period_month", { ascending: false })
    : { data: [] as ShareRow[] };
  const lines = (sRows || []) as ShareRow[];

  const yStart = today.slice(0, 4) + "-01-01";
  let shareYTD = 0, outstanding = 0;
  const per = new Map<string, { last?: ShareRow; outstanding: number; ytd: number }>();
  for (const l of lines) {
    const p = per.get(l.contract_id) || { outstanding: 0, ytd: 0 };
    if (!p.last) p.last = l;
    if (l.period_month >= yStart) { p.ytd += Number(l.share_eur); shareYTD += Number(l.share_eur); }
    if (!l.settled_on) { p.outstanding += Number(l.share_eur); outstanding += Number(l.share_eur); }
    per.set(l.contract_id, p);
  }
  const active = contracts.filter((c) => c.status === "active");
  const jvs = active.filter((c) => c.kind === "joint_venture");
  const expiring = contracts
    .filter((c) => c.status !== "ended" && expiryInfo(c, today).urgent)
    .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));

  const linked = new Set(contracts.map((c) => c.entity_id));
  const unlinked = demo ? [] : ctx.entities
    .filter((e) => e.entity_type === "partner" && !linked.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, status: e.status }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PortfolioHeader
        title="Partners"
        blurb="Joint ventures, revenue shares and the contracts behind them."
        path={PATH}
        demo={demo}
      />

      {contracts.length === 0 && !demo ? <EmptyLive what="partner contracts" path={PATH} /> : (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Active agreements" value={String(active.length)} sub={`${contracts.length} on file`} />
            <Stat label="Joint ventures" value={String(jvs.length)} />
            <Stat label="Share earned YTD" value={eur(shareYTD)} />
            <Stat label="Outstanding" value={eur(outstanding)} sub="statements not yet settled" tone={outstanding > 0 ? "warn" : undefined} />
          </section>

          {expiring.length ? (
            <>
              <SectionTitle>Contracts needing a decision</SectionTitle>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-ember/30">
                {expiring.map((c) => {
                  const ex = expiryInfo(c, today);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="font-serif text-[16px] text-ink">{contractParty(c)}</p>
                        <p className="font-sans text-[12px] text-clay">{c.title}</p>
                      </div>
                      <div className="text-right font-sans text-[12px] text-ink-soft">
                        <p>Ends {shortDate(c.end_date)} · {relDays(c.end_date, today)}</p>
                        {ex.noticeBy ? <p className="text-ember">Notice by {shortDate(ex.noticeBy)} ({relDays(ex.noticeBy, today)})</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          <SectionTitle>Network</SectionTitle>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {contracts.map((c) => {
              const p = per.get(c.id);
              return (
                <li key={c.id} className="rounded-lg border border-black/10 bg-paper/50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-[19px] leading-tight text-ink">{contractParty(c)}</p>
                      <p className="mt-0.5 font-sans text-[12px] text-clay">{c.title}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Pill>{KIND_LABEL[c.kind] || c.kind}</Pill>
                      <Pill tone={c.status === "active" ? "ok" : "muted"}>{c.status}</Pill>
                    </div>
                  </div>
                  <p className="mt-3 font-sans text-[13px] text-ink-soft">{terms(c)}</p>
                  {p?.last ? (
                    <p className="mt-1 font-sans text-[12px] text-ink-soft">
                      {monthLabel(p.last.period_month)}: {eur(p.last.share_eur)} of {eur(p.last.gross_eur)} gross
                      {p.last.settled_on ? <span className="text-clay"> · settled {shortDate(p.last.settled_on)}</span> : <span className="text-ember"> · unsettled</span>}
                    </p>
                  ) : null}
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {c.start_date ? `Since ${shortDate(c.start_date)}` : "No start date"}
                    {c.end_date ? ` · ends ${shortDate(c.end_date)}` : " · open-ended"}
                    {c.notice_days ? ` · ${c.notice_days}d notice` : ""}
                    {c.next_review_on ? ` · review ${shortDate(c.next_review_on)}` : ""}
                  </p>
                  {c.doc_url ? <a href={c.doc_url} className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wide text-ink underline">Contract</a> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!demo ? <UnlinkedEntities entities={unlinked} label="Partners" /> : null}
    </main>
  );
}
