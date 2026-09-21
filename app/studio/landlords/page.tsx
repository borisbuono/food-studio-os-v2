import { PortfolioHeader, Stat, SectionTitle, Pill, EmptyLive } from "@/components/portfolio/PortfolioChrome";
import { UnlinkedEntities } from "@/components/portfolio/UnlinkedEntities";
import {
  requireStudioAccess, isDemo, loadContracts, contractParty, madridToday,
  shortDate, relDays, eur, expiryInfo, rentDue, monthLabel,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

// /studio/landlords — landlord dashboard (task #34).
//
// Rents due · contract expiries · maintenance issues. Rent "due" is derived:
// a lease with rent_eur + rent_due_day owes each month that has no row in
// portfolio_rent_payments. Previous unpaid months show as overdue.

const PATH = "/studio/landlords";
const SEV_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

type PayRow = { contract_id: string; period_month: string };
type IssueRow = {
  id: string; contract_id: string | null; entity_id: string; title: string; severity: string;
  status: string; responsible: string | null; reported_on: string; cost_eur: number | null;
};

export default async function StudioLandlordsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { sb, ctx, entityIds } = await requireStudioAccess();
  const demo = isDemo(searchParams);
  const today = madridToday();

  const leases = await loadContracts(sb, ["lease"], demo, entityIds);
  const ids = leases.map((c) => c.id);
  const [payRes, issueRes] = await Promise.all([
    ids.length
      ? sb.from("portfolio_rent_payments").select("contract_id,period_month").in("contract_id", ids)
      : Promise.resolve({ data: [] as PayRow[] }),
    entityIds.length
      ? sb.from("portfolio_maintenance_issues")
          .select("id,contract_id,entity_id,title,severity,status,responsible,reported_on,cost_eur")
          .eq("is_demo", demo)
          .in("entity_id", entityIds)
          .neq("status", "done")
          .order("reported_on", { ascending: true })
      : Promise.resolve({ data: [] as IssueRow[] }),
  ]);
  const paid = new Map<string, Set<string>>();
  for (const r of ((payRes as any).data || []) as PayRow[]) {
    const s = paid.get(r.contract_id) || new Set<string>();
    s.add(String(r.period_month).slice(0, 10));
    paid.set(r.contract_id, s);
  }
  const issues = ((((issueRes as any).data || []) as IssueRow[])).sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || a.reported_on.localeCompare(b.reported_on),
  );

  const dues = leases
    .map((c) => ({ c, due: rentDue(c, paid.get(c.id) || new Set(), today) }))
    .filter((x) => x.due)
    .sort((a, b) => a.due!.dueOn.localeCompare(b.due!.dueOn));
  const monthlyRent = leases.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.rent_eur || 0), 0);
  const overdue = dues.filter((x) => x.due!.overdueDays > 0);
  const expiring = leases
    .filter((c) => c.status !== "ended" && c.end_date)
    .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
  const leaseName = new Map(leases.map((c) => [c.id, contractParty(c)]));

  const linked = new Set(leases.map((c) => c.entity_id));
  const unlinked = demo ? [] : ctx.entities
    .filter((e) => e.entity_type === "landlord" && !linked.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, status: e.status }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PortfolioHeader
        title="Landlords"
        blurb="Rent owed, leases running out, and what's broken on the premises."
        path={PATH}
        demo={demo}
      />

      {leases.length === 0 && issues.length === 0 && !demo ? <EmptyLive what="leases" path={PATH} /> : (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Monthly rent" value={eur(monthlyRent)} sub={`${leases.filter((c) => c.status === "active").length} active leases`} />
            <Stat label="Next rent" value={dues[0] ? eur(dues[0].due!.amount) : "—"} sub={dues[0] ? `${shortDate(dues[0].due!.dueOn)} · ${relDays(dues[0].due!.dueOn, today)}` : "nothing unpaid"} />
            <Stat label="Overdue" value={String(overdue.length)} sub={overdue.length ? eur(overdue.reduce((s, x) => s + x.due!.amount, 0)) : "all paid"} tone={overdue.length ? "warn" : "ok"} />
            <Stat label="Open issues" value={String(issues.length)} sub={`${issues.filter((i) => i.severity === "urgent" || i.severity === "high").length} high or urgent`} tone={issues.some((i) => i.severity === "urgent" || i.severity === "high") ? "warn" : undefined} />
          </section>

          <SectionTitle>Rents due</SectionTitle>
          {dues.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-black/10">
              {dues.map(({ c, due }) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-serif text-[16px] text-ink">{contractParty(c)}</p>
                    <p className="font-sans text-[12px] text-clay">{c.title} · {monthLabel(due!.period)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-sans text-[14px] text-ink">{eur(due!.amount)}</p>
                    <p className={`font-mono text-[10px] uppercase tracking-wide ${due!.overdueDays > 0 ? "text-ember" : "text-clay"}`}>
                      {due!.overdueDays > 0 ? `overdue ${due!.overdueDays}d` : `due ${shortDate(due!.dueOn)} · ${relDays(due!.dueOn, today)}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 font-sans text-[13px] text-clay">Nothing unpaid.</p>}

          <SectionTitle>Contract expiries</SectionTitle>
          {expiring.length ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
              <table className="w-full min-w-[560px] text-left font-sans text-[13px]">
                <thead className="font-mono text-[10px] uppercase tracking-wide text-clay">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-normal">Lease</th>
                    <th className="px-4 py-2 font-normal">Rent</th>
                    <th className="px-4 py-2 font-normal">Ends</th>
                    <th className="px-4 py-2 font-normal">Notice by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {expiring.map((c) => {
                    const ex = expiryInfo(c, today);
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-serif text-[15px] text-ink">{contractParty(c)}</p>
                          <p className="text-[12px] text-clay">{c.title}</p>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{eur(c.rent_eur)}{c.rent_due_day ? <span className="text-clay"> · day {c.rent_due_day}</span> : null}</td>
                        <td className={`px-4 py-3 ${ex.urgent ? "text-ember" : "text-ink-soft"}`}>
                          {shortDate(c.end_date)}<span className="block text-[11px] text-clay">{relDays(c.end_date, today)}</span>
                        </td>
                        <td className={`px-4 py-3 ${ex.daysToNotice != null && ex.daysToNotice <= 30 ? "text-ember" : "text-ink-soft"}`}>
                          {ex.noticeBy ? <>{shortDate(ex.noticeBy)}<span className="block text-[11px] text-clay">{c.notice_days}d · {relDays(ex.noticeBy, today)}</span></> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-3 font-sans text-[13px] text-clay">No lease end dates on file.</p>}

          <SectionTitle>Maintenance issues</SectionTitle>
          {issues.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-black/10">
              {issues.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-sans text-[14px] text-ink">{i.title}</p>
                    <p className="font-sans text-[12px] text-clay">
                      {i.contract_id ? leaseName.get(i.contract_id) || "—" : "—"}
                      {i.responsible ? ` · ${i.responsible} pays` : ""}
                      {i.cost_eur != null ? ` · ${eur(i.cost_eur)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={i.severity === "urgent" || i.severity === "high" ? "warn" : "muted"}>{i.severity}</Pill>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{i.status.replace("_", " ")} · {relDays(i.reported_on, today)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 font-sans text-[13px] text-clay">No open issues.</p>}
        </>
      )}

      {!demo ? <UnlinkedEntities entities={unlinked} label="Landlords" /> : null}
    </main>
  );
}
