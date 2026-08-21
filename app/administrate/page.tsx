import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity, serverRestaurantId } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL" };
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

// Architecture v2 — the Administrate pillar landing.
// Four tiles: Finance / Suppliers / Team / Decisions. Same shape as
// Develop / Execute / Grow — 4 tiles, one big number, one status sentence,
// one primary action.
export default async function AdministrateHome() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const rid = serverRestaurantId();
  const ec = ENTITY_CODE[entity] || "IFL";
  const today = new Date().toISOString().slice(0, 10);

  const [eodRes, unapprovedRes, bankRes, providersRes, teamRes, decisionsRes, advisoryRes, masterTodoRes, chartersRes] = await Promise.all([
    supabase.from("eod_accounting").select("revenue,actual_covers").eq("restaurant_id", rid).eq("report_date", today).maybeSingle(),
    supabase.from("invoice_inbox").select("id,amount_eur,entity_id,match_status").eq("entity_id", ec).not("match_status", "in", "(approved,rejected,duplicate)"),
    supabase.from("bank_movements").select("id,entity_id,reconciled_to").eq("entity_id", ec).eq("reconciled_to", "unmatched"),
    supabase.from("providers").select("id"),
    supabase.from("team_members").select("name,status"),
    // decisions is an inbox-ish table; count anything not resolved.
    supabase.from("decisions").select("id,resolved_at"),
    supabase.from("v_advisory_clients_overview").select("id,status"),
    // PA integration Sprint 1 — Master_ToDo pending count for the sub-strip.
    supabase.from("master_todos").select("id,title,impact_score,entity_code,status").not("status", "in", "(completed,deferred)"),
    // PA integration Sprint 2 — Agent charter tile.
    supabase.from("agent_charters").select("id,entity_code,status").in("status", ["ready","running"]),
  ]);

  const todayRev = Number(eodRes.data?.revenue || 0);
  const unapprovedCount = (unapprovedRes.data || []).length;
  const unapprovedTotal = (unapprovedRes.data || []).reduce((a: number, r: any) => a + Number(r.amount_eur || 0), 0);
  const bankUnmatched = (bankRes.data || []).length;
  const suppliers = (providersRes.data || []).length;
  const team = (teamRes.data || []).length;
  const pendingInvites = (teamRes.data || []).filter((m: any) => (m.status || "invited") === "invited").length;
  const openDecisions = (decisionsRes.data || []).filter((d: any) => !d.resolved_at).length;
  const advClients = (advisoryRes.data || []) as { id: string; status: string }[];
  const advActive  = advClients.filter((c) => c.status === "active" || c.status === "onboarding").length;
  const masterTodos = (masterTodoRes.data || []).filter((t: any) => !t.entity_code || t.entity_code === ec);
  const topTodo = masterTodos.slice().sort((a: any, b: any) => (b.impact_score || 0) - (a.impact_score || 0))[0];
  const openCharters = (chartersRes.data || []).filter((c: any) => !c.entity_code || c.entity_code === ec).length;

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <PillarHeader
        kicker={`Administrate · ${ec}`}
        title="The engine room."
        blurb="Numbers, invoices, suppliers, team. What the business needs from you today."
      />

      <section className="mt-10">
        <PillarTile
          href="/administrate/finance"
          kicker="Finance · today's pulse"
          title="The numbers"
          value={todayRev ? eur(todayRev) : "—"}
          status={
            todayRev
              ? `Today's revenue · ${unapprovedCount} invoice${unapprovedCount === 1 ? "" : "s"} waiting · ${bankUnmatched} bank movement${bankUnmatched === 1 ? "" : "s"} unmatched`
              : `No EOD yet today · ${unapprovedCount} invoice${unapprovedCount === 1 ? "" : "s"} waiting${unapprovedTotal ? " · " + eur(unapprovedTotal) + " pending" : ""}`
          }
          action="Open the numbers →"
        />
        <PillarTile
          href="/administrate/suppliers"
          kicker="Suppliers · ordering + costs"
          title="Suppliers"
          value={suppliers}
          status={suppliers === 0
            ? "No suppliers yet — add one to start ordering."
            : `${suppliers} supplier${suppliers === 1 ? "" : "s"} on file — orders, prices, invoices`}
          action="Browse suppliers →"
        />
        <PillarTile
          href="/administrate/team"
          kicker="Team · roster + HR"
          title="Team"
          value={team}
          status={team === 0
            ? "No team on file yet — invite the first person."
            : pendingInvites
            ? `${team} on the team · ${pendingInvites} invite${pendingInvites === 1 ? "" : "s"} still pending`
            : `${team} on the team — the roster is up to date`}
          action="See the team →"
        />
        <PillarTile
          href="/administrate/decisions"
          kicker="Decisions · inbox"
          title="Decisions"
          value={openDecisions}
          status={openDecisions === 0
            ? "Nothing waiting — the inbox is clear."
            : `${openDecisions} decision${openDecisions === 1 ? "" : "s"} waiting on you`}
          action="Open decisions →"
        />
        <PillarTile
          href="/administrate/advisor"
          kicker="Advisor · client book"
          title="Advisory"
          value={advClients.length}
          status={advClients.length === 0
            ? "No advisory clients yet — bring the first one on."
            : `${advClients.length} on the book · ${advActive} live`}
          action="Open advisor console →"
        />
        <PillarTile
          href="/administrate/master-todo"
          kicker="Master ToDo · what the PA is holding"
          title="Master ToDo"
          value={masterTodos.length}
          status={masterTodos.length === 0
            ? "Nothing on the plate — the PA is quiet."
            : topTodo
              ? `Top move · ${String(topTodo.title || "").slice(0, 60)}`
              : `${masterTodos.length} open`}
          action="Open the plate →"
        />
        <PillarTile
          href="/administrate/agent-charters"
          kicker="Agent charters · scope every task"
          title="Charters"
          value={openCharters}
          status={openCharters === 0
            ? "No charters running — spawn one to scope an agent task."
            : `${openCharters} charter${openCharters === 1 ? "" : "s"} in flight`}
          action="Open charters →"
        />
      </section>
    </main>
  );
}
