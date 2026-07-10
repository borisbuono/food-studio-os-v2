import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import AssistantContext from "@/components/AssistantContext";
import AnomaliesClient from "./AnomaliesClient";

export const dynamic = "force-dynamic";

// Anomaly triage — /administrate/finance/anomalies.
//
// One place to look at every unresolved finance anomaly the nightly scan
// found. Filter by entity + severity, drill into a row to see the meta
// blob and the source it points at, resolve or snooze. Editorial identity,
// empty states everywhere, additive over the finance section.
export default async function AnomaliesPage() {
  const sb = supabaseServer();
  const { data } = await sb.from("finance_anomalies")
    .select("id,entity_code,kind,description,severity,detected_at,resolved_at,resolved_by,snoozed_until,meta,first_seen_date,last_seen_date,source_table,source_id,updated_at")
    .order("severity", { ascending: false })
    .order("last_seen_date", { ascending: false })
    .limit(500);
  const rows = data || [];

  // Compact context for the FAB — same rows sorted by severity, so a
  // conversational "any anomalies right now?" works from this page.
  const chefContext = {
    kind: "finance_anomalies",
    total: rows.length,
    unresolved: rows.filter((r: any) => !r.resolved_at).length,
    top: rows.slice(0, 5).map((r: any) => ({ entity: r.entity_code, kind: r.kind, severity: r.severity, description: r.description })),
  };

  return (
    <>
      <AssistantContext context={chefContext} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/administrate/finance" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Command Center · Anomaly triage</p>
        <h1 className="mt-1 font-serif text-[34px] leading-[1.05] text-ink">What the numbers are saying.</h1>
        <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Nine detectors run nightly across IFL, BM, BBH. Anything unusual lands here first so the finance corner never surprises you.</p>
        <AnomaliesClient rows={rows as any} />
      </main>
    </>
  );
}
