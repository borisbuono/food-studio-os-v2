import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity, serverRestaurantId } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import { PillarTile, PillarHeader } from "@/components/PillarTile";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

// Office pillar — books, team, holdings, ads. The operator's back-office.
// Tiles carry temporal-flow chips (admin/grow) so the operator sees where a
// screen lives in the close/guest arcs even though the top nav no longer
// exposes those labels.
export default async function OfficeHome() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const rid = serverRestaurantId();
  const ec = ENTITY_CODE[entity] || "IFL";
  const today = new Date().toISOString().slice(0, 10);

  const [eodRes, unapprovedRes, bankRes, teamRes, chartersRes, campaignsRes, commercialsRes] = await Promise.all([
    supabase.from("eod_accounting").select("revenue,actual_covers").eq("restaurant_id", rid).eq("report_date", today).maybeSingle(),
    supabase.from("invoice_inbox").select("id,amount_eur,entity_id,match_status").eq("entity_id", ec).not("match_status", "in", "(approved,rejected,duplicate)"),
    supabase.from("bank_movements").select("id,entity_id,reconciled_to").eq("entity_id", ec).eq("reconciled_to", "unmatched"),
    supabase.from("team_members").select("name,status"),
    supabase.from("agent_charters").select("id,status").eq("status", "open"),
    supabase.from("campaigns").select("id,status").eq("restaurant_id", rid),
    supabase.from("commercials").select("id,status").eq("restaurant_id", rid),
  ]);

  const eodToday = eodRes.data;
  const unapprovedCount = (unapprovedRes.data || []).length;
  const bankOpen = (bankRes.data || []).length;
  const team = teamRes.data || [];
  const activeTeam = team.filter((t: any) => t.status !== "archived").length;
  const openCharters = (chartersRes.data || []).length;
  const activeCampaigns = (campaignsRes.data || []).filter((c: any) => c.status === "active").length;
  const commercials = (commercialsRes.data || []).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <PillarHeader
        kicker="Office · the ledger"
        title="Run the business."
        blurb="Finance, team, suppliers, holdings, ads. What the operator holds."
      />

      <section className="mt-10">
        <PillarTile
          href="/administrate/finance"
          kicker="Finance · today"
          title="Finance"
          value={eodToday ? eur(Number(eodToday.revenue || 0)) : "—"}
          status={eodToday
            ? `${eodToday.actual_covers || 0} covers · today's numbers posted`
            : "No EOD posted yet today"}
          action="Open finance →"
          flowChip="admin"
        />
        <PillarTile
          href="/administrate/finance/scans"
          kicker="Invoices · to approve"
          title="Inbox"
          value={unapprovedCount}
          status={unapprovedCount === 0
            ? "Inbox is clear."
            : `${unapprovedCount} invoice${unapprovedCount === 1 ? "" : "s"} waiting on approval`}
          action="Triage the inbox →"
          flowChip="admin"
        />
        <PillarTile
          href="/administrate/finance/reconciliation"
          kicker="Bank · unmatched"
          title="Reconciliation"
          value={bankOpen}
          status={bankOpen === 0
            ? "Bank is reconciled — nothing waiting."
            : `${bankOpen} movement${bankOpen === 1 ? "" : "s"} unmatched — review candidates`}
          action="Match bank →"
          flowChip="admin"
        />
        <PillarTile
          href="/administrate/team"
          kicker="Team · roster"
          title="Team"
          value={activeTeam}
          status={activeTeam === 0
            ? "No team members on the roster yet."
            : `${activeTeam} active teammate${activeTeam === 1 ? "" : "s"}`}
          action="Open the roster →"
          flowChip="admin"
        />
        <PillarTile
          href="/administrate/suppliers"
          kicker="Suppliers · profiles"
          title="Suppliers"
          value="—"
          status="Every supplier — orders, prices, invoices in one profile."
          action="Open suppliers →"
          flowChip="admin"
        />
        <PillarTile
          href="/administrate/holdings/console"
          kicker="Holdings · group view"
          title="Holdings"
          value="—"
          status="The rolled-up group view — every entity in one console."
          action="Open holdings →"
          flowChip="admin"
        />
        <PillarTile
          href="/grow/reach"
          kicker="Reach · campaigns + ads"
          title="Reach"
          value={activeCampaigns}
          status={activeCampaigns === 0
            ? "No active campaigns."
            : `${activeCampaigns} campaign${activeCampaigns === 1 ? "" : "s"} live`}
          action="Open reach →"
          flowChip="grow"
        />
        <PillarTile
          href="/grow/commercials"
          kicker="Commercials · offers"
          title="Commercials"
          value={commercials}
          status={commercials === 0
            ? "No offers configured yet."
            : `${commercials} commercial offer${commercials === 1 ? "" : "s"}`}
          action="Open commercials →"
          flowChip="grow"
        />
        <PillarTile
          href="/administrate/master-todo"
          kicker="Master ToDo · impact-ranked"
          title="ToDo"
          value={openCharters}
          status={openCharters === 0
            ? "No open agent charters."
            : `${openCharters} open agent charter${openCharters === 1 ? "" : "s"} — scope before you start`}
          action="Open master ToDo →"
          flowChip="admin"
        />
      </section>
    </main>
  );
}
