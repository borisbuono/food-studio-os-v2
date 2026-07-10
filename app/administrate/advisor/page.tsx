import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import AdvisorConsoleClient from "./AdvisorConsoleClient";
import AssistantContext from "@/components/AssistantContext";
import type { AdvisoryClientOverview } from "@/lib/advisory/types";

export const dynamic = "force-dynamic";

// The advisor console — Boris's view of every advisory client he runs.
// One row per client with the shape of the relationship: venues, seats,
// status, month-to-date revenue, month-to-date assistant cost, flags.
// Row click drills into the per-client dashboard; the button opens the
// six-step onboarding wizard on the "advisory" branch.
export default async function AdvisorConsole() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const [clientsRes, mtdRes, actionsErrRes] = await Promise.all([
    sb.from("v_advisory_clients_overview").select("*").order("status").order("name"),
    sb.from("v_assistant_entity_mtd").select("entity_code,actions,cost_eur"),
    sb.from("assistant_actions").select("entity_code,created_at,action_type").ilike("action_type","%error%").order("created_at",{ ascending:false }).limit(50),
  ]);

  const clients = (clientsRes.data || []) as AdvisoryClientOverview[];
  const mtdMap  = new Map<string, { actions: number; cost_eur: number }>();
  for (const r of (mtdRes.data || [])) mtdMap.set((r as any).entity_code, { actions: Number((r as any).actions || 0), cost_eur: Number((r as any).cost_eur || 0) });
  const errMap = new Map<string, number>();
  for (const r of (actionsErrRes.data || [])) {
    const ec = (r as any).entity_code as string | null;
    if (!ec) continue;
    errMap.set(ec, (errMap.get(ec) || 0) + 1);
  }

  const rows = clients.map((c) => {
    const m = mtdMap.get(c.entity_code) || { actions: 0, cost_eur: 0 };
    return {
      ...c,
      mtd_actions: m.actions,
      mtd_cost_eur: m.cost_eur,
      recent_errors: errMap.get(c.entity_code) || 0,
    };
  });

  const totals = {
    clients:   rows.length,
    active:    rows.filter((r) => r.status === "active").length,
    onboarding:rows.filter((r) => r.status === "onboarding").length,
    prospects: rows.filter((r) => r.status === "prospect").length,
    seats:     rows.reduce((a, r) => a + Number(r.accepted_seats || 0), 0),
    venues:    rows.reduce((a, r) => a + Number(r.venues_count || 0), 0),
    mtd_cost:  rows.reduce((a, r) => a + Number(r.mtd_cost_eur || 0), 0),
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12" style={{ ["--accent" as any]: "#3F4C28" }}>
      <AssistantContext
        context={{
          kind: "advisor_console",
          totals,
          clients: rows.map((r) => ({ entity_code: r.entity_code, name: r.name, status: r.status, tier: r.tier, venues: r.venues_count, seats: r.accepted_seats, mtd_cost_eur: r.mtd_cost_eur, pending_invites: r.pending_invites, recent_errors: r.recent_errors })),
        }}
      />

      <Link href="/administrate" className="font-mono text-[10px] uppercase tracking-wide text-clay">← administrate</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Advisor · client console</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">The advisory book.</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        Every group we advise, at a glance. One row for each client — where they are in the funnel, how many venues
        and seats, what the Assistant is spending, and what's asking for attention. Click a row to drill in; open the
        wizard to bring a new one on.
      </p>

      <section className="mt-10 grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
        <HeadlineNumber label="Clients" value={String(totals.clients)} sub={totals.active + " active · " + totals.onboarding + " onboarding"} />
        <HeadlineNumber label="Prospects" value={totals.prospects ? String(totals.prospects) : "—"} sub="in the funnel" />
        <HeadlineNumber label="Venues · seats" value={totals.venues + " · " + totals.seats} sub="across the book" />
        <HeadlineNumber label="Assistant · MTD" value={totals.mtd_cost > 0 ? "€" + totals.mtd_cost.toFixed(2) : "—"} sub="cost this month" />
      </section>

      <AdvisorConsoleClient rows={rows} />
    </main>
  );
}

function HeadlineNumber({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-1 font-serif text-[32px] text-ink leading-none">{value}</p>
      <p className="mt-2 font-mono text-[10px] text-ink-soft">{sub}</p>
    </div>
  );
}
