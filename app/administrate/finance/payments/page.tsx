import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import AssistantContext from "@/components/AssistantContext";
import PaymentsClient from "./PaymentsClient";

export const dynamic = "force-dynamic";

// Full view for the Payments tile.
// Sortable table across all entities, filter chips per entity, "Fix now" opens
// the vendor's billing page in a new tab. The row-level Fix targets come from
// platform_billing_status.billing_url (seeded in the migration).
export default async function PaymentsPage() {
  const sb = supabaseServer();
  const { data } = await sb.from("platform_billing_status")
    .select("id,entity_code,platform,state,card_last4,next_charge_date,last_success_at,last_failure_at,failure_count_30d,billing_url,notes,updated_at");
  const rows = data || [];

  // Build a compact context blob so Chef (the FAB) can answer "any billing issues"
  // even from this page — same rows, sorted by severity, no PII.
  const chefContext = {
    kind: "billing_status",
    total: rows.length,
    not_healthy: rows.filter((r: any) => r.state !== "healthy" && r.state !== "missing_card").length,
    rows: rows.map((r: any) => ({
      entity: r.entity_code, platform: r.platform, state: r.state,
      fails_30d: r.failure_count_30d, last_failure: r.last_failure_at,
    })),
  };

  return (
    <>
      <AssistantContext context={chefContext} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/administrate/finance" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Command Center · Payment health</p>
        <h1 className="mt-1 font-serif text-[34px] leading-[1.05] text-ink">Are we being charged?</h1>
        <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Every SaaS bill across IFL, BM, BBH. Anything not <span className="text-basil">healthy</span> gets a card. Tap "Fix now" to open the vendor's billing page.</p>
        <PaymentsClient rows={rows as any} />
      </main>
    </>
  );
}
