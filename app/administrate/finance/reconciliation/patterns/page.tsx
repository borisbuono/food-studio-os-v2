import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import PatternsClient from "./PatternsClient";
import AssistantContext from "@/components/AssistantContext";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<string, "IFL" | "BM" | "BBH"> = { taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };

export default async function PatternsPage() {
  const sb = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  const { data } = await sb
    .from("recurring_bank_patterns")
    .select("id,entity_code,pattern_type,reference_regex,expected_amount_range,expected_frequency,match_type,label,learn_confidence,first_seen,last_seen,times_matched,disabled_at,bank_account,created_at")
    .eq("entity_code", ec)
    .order("times_matched", { ascending: false })
    .limit(200);
  const rows = ((data as any[]) || []) as any[];

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <AssistantContext context={{ kind: "bank_patterns", entity: ec, patterns: rows.slice(0, 30).map((p) => ({ label: p.label, type: p.pattern_type, freq: p.expected_frequency, times: p.times_matched, disabled: !!p.disabled_at })) }} />
      <Link href="/administrate/finance/reconciliation" className="font-sans text-sm text-ink-soft">← reconciliation</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Bank · {ec} · learned patterns</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">What the bank does again and again.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Every recurring pattern the matcher has learned from your accepted matches — salaries, subscriptions, taxes, intercompany loops. Add one manually if the shape isn't showing up yet.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-line pt-5">
        <div><p className="font-serif text-2xl text-ink">{rows.filter((r) => !r.disabled_at).length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Active</p></div>
        <div><p className="font-serif text-2xl text-ink">{rows.filter((r) => r.disabled_at).length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Disabled</p></div>
        <div><p className="font-serif text-2xl text-ink">{rows.reduce((a, r) => a + Number(r.times_matched || 0), 0)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Total matches</p></div>
      </div>

      <PatternsClient initial={rows as any} entityCode={ec} />
    </main>
  );
}
