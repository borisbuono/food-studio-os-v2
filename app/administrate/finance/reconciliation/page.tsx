import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import AssistantContext from "@/components/AssistantContext";
import ProposedMatchesClient, { type OpenMatch, type AltCandidate } from "./ProposedMatchesClient";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<string, "IFL" | "BM" | "BBH"> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
const eur = (n: number) => (n < 0 ? "-€" : "€") + Math.abs(n).toFixed(2);
const CAT: Record<string, string> = {
  invoice: "Invoice",
  salesreceipt: "Sales receipt",
  asiento: "Asiento",
  intercompany: "Intercompany",
  tax: "Tax payment",
  tip: "Tip",
  fee: "Fee",
  unmatched: "Unmatched",
};

export default async function Reconciliation() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";

  const [items, openMatches, altCandidates] = await Promise.all([
    supabase
      .from("bank_movements")
      .select("id,movement_date,amount_eur,description,bank_account,reconciled_to,reconciled_to_id,holded_movement_id,notes,reconciled_status")
      .eq("entity_id", ec)
      .order("movement_date", { ascending: false })
      .limit(200),
    supabase
      .from("v_bank_matches_open")
      .select("movement_id,entity_code,bank_account,movement_date,amount_eur,description,reconciled_status,top_candidate_id,top_match_type,top_match_target_id,top_match_target_label,top_finder,top_confidence,top_rationale")
      .eq("entity_code", ec)
      .order("top_confidence", { ascending: false, nullsFirst: false })
      .order("movement_date", { ascending: false })
      .limit(150),
    supabase
      .from("bank_match_candidates")
      .select("id,bank_movement_id,match_type,match_target_id,match_target_label,finder,confidence,rationale,status")
      .eq("entity_code", ec)
      .eq("status", "proposed")
      .order("confidence", { ascending: false })
      .limit(400),
  ]);

  const rows = (items.data as any[]) || [];
  const unmatched = rows.filter((r) => r.reconciled_to === "unmatched");
  const matched = rows.filter((r) => r.reconciled_to !== "unmatched");
  const unmatchedTotal = unmatched.reduce((a, r) => a + Math.abs(Number(r.amount_eur || 0)), 0);

  const openList: OpenMatch[] = ((openMatches.data as any[]) || []).map((r) => ({
    movement_id: r.movement_id,
    entity_code: r.entity_code,
    bank_account: r.bank_account,
    movement_date: r.movement_date,
    amount_eur: Number(r.amount_eur || 0),
    description: r.description,
    reconciled_status: r.reconciled_status,
    top_candidate_id: r.top_candidate_id,
    top_match_type: r.top_match_type,
    top_match_target_id: r.top_match_target_id,
    top_match_target_label: r.top_match_target_label,
    top_finder: r.top_finder,
    top_confidence: r.top_confidence == null ? null : Number(r.top_confidence),
    top_rationale: r.top_rationale,
  }));

  const altsByMovement: Record<string, AltCandidate[]> = {};
  for (const c of ((altCandidates.data as any[]) || [])) {
    const list = altsByMovement[c.bank_movement_id] || [];
    list.push({
      id: c.id,
      bank_movement_id: c.bank_movement_id,
      match_type: c.match_type,
      match_target_id: c.match_target_id,
      match_target_label: c.match_target_label,
      finder: c.finder,
      confidence: Number(c.confidence || 0),
      rationale: c.rationale,
    });
    altsByMovement[c.bank_movement_id] = list;
  }

  const proposedCount = openList.filter((r) => r.top_candidate_id).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <AssistantContext context={{ kind: "bank_movements", entity: ec, unmatched: (unmatched || []).slice(0, 50).map((m: any) => ({ id: m.id, date: m.movement_date, description: m.description, amount_eur: m.amount_eur, bank_account: m.bank_account })), proposed_count: proposedCount }} />
      <Link href="/administrate/finance/dashboard" className="font-sans text-sm text-ink-soft">← dashboard</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Bank · {ec} · reconciliation</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">What's in motion.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Every bank movement, matched or not. The matcher proposes — you decide. Proposed matches sit on top, then any older unmatched rows below.</p>

      <div className="mt-8 grid grid-cols-4 gap-3 border-t border-line pt-5">
        <div><p className="font-serif text-2xl text-ink">{unmatched.length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Unmatched</p></div>
        <div><p className="font-serif text-2xl text-ink">{proposedCount}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Proposed</p></div>
        <div><p className="font-serif text-2xl text-ink">{matched.length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Reconciled</p></div>
        <div><p className="font-serif text-2xl text-ink">{eur(unmatchedTotal)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">€ in motion</p></div>
      </div>

      <section className="mt-8 border-t border-line pt-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Proposed matches</p>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">
          Nothing is reconciled without you. Every row here is a suggestion — accept to write it to the ledger, reject to send the finder back to work, or reconcile manually if the answer isn't in the list.
        </p>
        <ProposedMatchesClient rows={openList} altsByMovement={altsByMovement} entityCode={ec} />
      </section>

      {rows.length === 0 ? (
        <p className="mt-10 font-serif italic text-[15px] text-ink-soft">No bank movements ingested yet. Connect Holded Treasury sync to populate.</p>
      ) : (
        <>
          {matched.length > 0 ? (
            <section className="mt-10">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Recently reconciled · last {Math.min(20, matched.length)}</p>
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {matched.slice(0, 20).map((r) => {
                  const positive = Number(r.amount_eur) >= 0;
                  return (
                    <li key={r.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-sans text-[14px] text-ink-soft truncate">{r.description || "—"}</span>
                        <span className={"font-mono text-[12px] " + (positive ? "text-basil" : "text-clay")}>{positive ? "+" : ""}{eur(Number(r.amount_eur))}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">{new Date(r.movement_date).toLocaleDateString("en-GB")} · {CAT[r.reconciled_to] || r.reconciled_to}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
