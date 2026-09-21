import { PortfolioHeader, Stat, SectionTitle, Pill, EmptyLive } from "@/components/portfolio/PortfolioChrome";
import { UnlinkedEntities } from "@/components/portfolio/UnlinkedEntities";
import {
  requireStudioAccess, isDemo, loadContracts, contractParty, madridToday, monthStart,
  shortDate, relDays, eur, expiryInfo, daysBetween,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

// /studio/advisory — advisory dashboard (task #34).
//
// Client portfolio · engagement status · billed hours · next reviews.
// Studio scope: oversight only. No time-entry form here — hours are logged
// inside the engagement, not at portfolio level.

const PATH = "/studio/advisory";

type TimeRow = { contract_id: string; worked_on: string; hours: number; rate_eur: number | null; billed_at: string | null };

export default async function StudioAdvisoryPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { sb, ctx, entityIds } = await requireStudioAccess();
  const demo = isDemo(searchParams);
  const today = madridToday();
  const m0 = monthStart(today);

  const contracts = await loadContracts(sb, ["advisory_engagement"], demo, entityIds);
  const ids = contracts.map((c) => c.id);
  const { data: tRows } = ids.length
    ? await sb.from("portfolio_time_entries").select("contract_id,worked_on,hours,rate_eur,billed_at").in("contract_id", ids)
    : { data: [] as TimeRow[] };
  const time = (tRows || []) as TimeRow[];

  const rateFor = (t: TimeRow) => Number(t.rate_eur ?? contracts.find((c) => c.id === t.contract_id)?.hourly_rate_eur ?? 0);
  const per = new Map<string, { hours: number; unbilledH: number; unbilledEur: number; lastWorked: string | null }>();
  let hoursMTD = 0, unbilledH = 0, unbilledEur = 0, billedMTDEur = 0;
  for (const t of time) {
    const h = Number(t.hours);
    const p = per.get(t.contract_id) || { hours: 0, unbilledH: 0, unbilledEur: 0, lastWorked: null };
    p.hours += h;
    if (!p.lastWorked || t.worked_on > p.lastWorked) p.lastWorked = t.worked_on;
    if (!t.billed_at) { p.unbilledH += h; p.unbilledEur += h * rateFor(t); unbilledH += h; unbilledEur += h * rateFor(t); }
    else if (t.billed_at.slice(0, 10) >= m0) billedMTDEur += h * rateFor(t);
    if (t.worked_on >= m0) hoursMTD += h;
    per.set(t.contract_id, p);
  }

  const active = contracts.filter((c) => c.status === "active");
  const reviews = contracts
    .filter((c) => c.next_review_on && c.status !== "ended")
    .sort((a, b) => String(a.next_review_on).localeCompare(String(b.next_review_on)));

  // Live mode: advisory_client entities in scope with no engagement row.
  const linked = new Set(contracts.map((c) => c.entity_id));
  const unlinked = demo ? [] : ctx.entities
    .filter((e) => e.entity_type === "advisory_client" && !linked.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, status: e.status }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PortfolioHeader
        title="Advisory"
        blurb="Clients, engagements, hours and the next review with each."
        path={PATH}
        demo={demo}
      />

      {contracts.length === 0 && !demo ? <EmptyLive what="advisory engagements" path={PATH} /> : (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Active engagements" value={String(active.length)} sub={`${contracts.length} on file`} />
            <Stat label="Hours this month" value={hoursMTD.toLocaleString("en-GB", { maximumFractionDigits: 1 })} />
            <Stat label="Unbilled" value={eur(unbilledEur)} sub={`${unbilledH.toLocaleString("en-GB", { maximumFractionDigits: 1 })} h waiting to invoice`} tone={unbilledEur > 0 ? "warn" : undefined} />
            <Stat label="Billed this month" value={eur(billedMTDEur)} />
          </section>

          <SectionTitle>Next reviews</SectionTitle>
          {reviews.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-black/10">
              {reviews.slice(0, 6).map((c) => {
                const near = daysBetween(today, String(c.next_review_on)) <= 7;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-serif text-[16px] text-ink">{contractParty(c)}</p>
                      <p className="font-sans text-[12px] text-clay">{c.title}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-sans text-[13px] text-ink-soft">{shortDate(c.next_review_on)}</p>
                      <p className={`font-mono text-[10px] uppercase tracking-wide ${near ? "text-ember" : "text-clay"}`}>{relDays(c.next_review_on, today)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 font-sans text-[13px] text-clay">No reviews scheduled.</p>}

          <SectionTitle>Client portfolio</SectionTitle>
          <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
            <table className="w-full min-w-[640px] text-left font-sans text-[13px]">
              <thead className="font-mono text-[10px] uppercase tracking-wide text-clay">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-normal">Client</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Fee</th>
                  <th className="px-4 py-2 font-normal text-right">Hours</th>
                  <th className="px-4 py-2 font-normal text-right">Unbilled</th>
                  <th className="px-4 py-2 font-normal">Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {contracts.map((c) => {
                  const p = per.get(c.id);
                  const ex = expiryInfo(c, today);
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-serif text-[15px] text-ink">{contractParty(c)}</p>
                        <p className="text-[12px] text-clay">{c.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={c.status === "active" ? "ok" : "muted"}>{c.status}</Pill>
                        {c.entity?.status && c.entity.status !== "active" && !c.is_demo ? <span className="ml-1"><Pill tone="muted">entity {c.entity.status}</Pill></span> : null}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {c.fee_cadence === "hourly" ? `${eur(c.hourly_rate_eur)}/h` : c.fee_eur != null ? `${eur(c.fee_eur)} ${c.fee_cadence === "one_off" ? "one-off" : `/ ${(c.fee_cadence || "").replace("ly", "")}`}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-soft">
                        {p ? p.hours.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "0"}
                        {p?.lastWorked ? <span className="block text-[11px] text-clay">last {shortDate(p.lastWorked)}</span> : null}
                      </td>
                      <td className={`px-4 py-3 text-right ${p && p.unbilledEur > 0 ? "text-ember" : "text-ink-soft"}`}>
                        {p && p.unbilledH > 0 ? <>{eur(p.unbilledEur)}<span className="block text-[11px] text-clay">{p.unbilledH} h</span></> : "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {c.end_date ? <>{shortDate(c.end_date)}{ex.urgent ? <span className="block text-[11px] text-ember">{relDays(c.end_date, today)}</span> : null}</> : "open"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!demo ? <UnlinkedEntities entities={unlinked} label="Advisory clients" /> : null}
    </main>
  );
}
