import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import AssistantContext from "@/components/AssistantContext";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<string, string> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
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

  const { data: items } = await supabase
    .from("bank_movements")
    .select("id,movement_date,amount_eur,description,bank_account,reconciled_to,reconciled_to_id,holded_movement_id,notes")
    .eq("entity_id", ec)
    .order("movement_date", { ascending: false })
    .limit(200);
  const rows = (items as any[]) || [];
  const unmatched = rows.filter((r) => r.reconciled_to === "unmatched");
  const matched = rows.filter((r) => r.reconciled_to !== "unmatched");
  const unmatchedTotal = unmatched.reduce((a, r) => a + Math.abs(Number(r.amount_eur || 0)), 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <AssistantContext context={{ kind: "bank_movements", entity: ec, unmatched: (unmatched || []).slice(0, 50).map((m: any) => ({ id: m.id, date: m.movement_date, description: m.description, amount_eur: m.amount_eur, bank_account: m.bank_account })) }} />
      <Link href="/administrate/finance/dashboard" className="font-sans text-sm text-ink-soft">← dashboard</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Bank · {ec} · reconciliation</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">What's in motion.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Every bank movement, matched or not. Unmatched sit on top so you can categorise them — invoice paid, sales receipt settled, intercompany transfer, tax filing.</p>

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-line pt-5">
        <div><p className="font-serif text-2xl text-ink">{unmatched.length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Unmatched</p></div>
        <div><p className="font-serif text-2xl text-ink">{matched.length}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Reconciled</p></div>
        <div><p className="font-serif text-2xl text-ink">{eur(unmatchedTotal)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">€ in motion</p></div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 font-serif italic text-[15px] text-ink-soft">No bank movements ingested yet. Connect Holded Treasury sync to populate.</p>
      ) : (
        <>
          {unmatched.length > 0 ? (
            <section className="mt-10">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Unmatched · {unmatched.length}</p>
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {unmatched.map((r) => {
                  const positive = Number(r.amount_eur) >= 0;
                  return (
                    <li key={r.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-serif text-[15px] text-ink">{r.description || "—"}</span>
                        <span className={"font-mono text-[13px] " + (positive ? "text-basil" : "text-tomato")}>{positive ? "+" : ""}{eur(Number(r.amount_eur))}</span>
                      </div>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">{new Date(r.movement_date).toLocaleDateString("en-GB")} · {r.bank_account}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {matched.length > 0 ? (
            <section className="mt-10">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Reconciled · last {matched.length}</p>
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

      <p className="mt-12 font-mono text-[10px] uppercase tracking-wide text-clay">One-click categorise + auto-match (against invoice_inbox and orders) lands in the next iteration.</p>
    </main>
  );
}
