import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<string, string> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
const eur = (n: number | null | undefined) => n == null ? "—" : "€" + Number(n).toFixed(2);
const SOURCE_LABEL: Record<string, string> = {
  holded_scan: "Holded scan",
  email_forward: "Email",
  whatsapp: "WhatsApp",
  manual_upload: "Uploaded",
  paper_photo: "Photo",
  portal: "Portal",
};
const FLAG_TONE: Record<string, string> = {
  duplicate: "tomato",
  intercompany: "amber",
  eu_vat_recovery: "amber",
  high_value_no_doc: "tomato",
};

export default async function Scans({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  const tab = (searchParams?.status || "open") as "open" | "approved" | "all";

  let query = supabase
    .from("invoice_inbox")
    .select("id,arrived_at,source,source_ref,amount_eur,vat_eur,match_status,flagged_reason,holded_doc_id,doc_url,notes,supplier_name,provider:provider_id(name)")
    .eq("entity_id", ec)
    .order("arrived_at", { ascending: false })
    .limit(100);
  if (tab === "open") query = query.not("match_status", "in", "(approved,rejected,duplicate)");
  else if (tab === "approved") query = query.eq("match_status", "approved");

  const { data: items } = await query;
  const rows: any[] = (items as any[]) || [];

  const openCount = rows.filter((r) => !["approved","rejected","duplicate"].includes(r.match_status)).length;
  const approvedCount = rows.filter((r) => r.match_status === "approved").length;
  const flaggedCount = rows.filter((r) => r.flagged_reason).length;
  const safeToApprove = rows.filter((r) => !r.flagged_reason && r.match_status === "matched_order" && r.amount_eur != null);
  const stuckTotal = rows.filter((r) => !["approved","rejected","duplicate"].includes(r.match_status)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/administrate/finance/dashboard" className="font-sans text-sm text-ink-soft">← dashboard</Link>
      <a href="/capture" className="ml-3 inline-block font-mono text-sm text-tomato">+ 📷 capture</a>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Scans · {ec} · invoice triage</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">What needs a call.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Every factura that landed today. Duplicates, EU-VAT, intercompany — pre-flagged. Safe-to-approve sit at the top so you can tap through fast.</p>

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-line pt-5">
        <div><p className="font-serif text-2xl text-ink">{openCount}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Open</p></div>
        <div><p className="font-serif text-2xl text-ink">{flaggedCount}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">Flagged</p></div>
        <div><p className="font-serif text-2xl text-ink">{eur(stuckTotal)}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">€ awaiting</p></div>
      </div>

      <div className="mt-6 flex gap-4 border-b border-line">
        <Link href="?status=open" className={"pb-2 font-mono text-[11px] uppercase tracking-wide " + (tab === "open" ? "text-ink border-b-2" : "text-clay")} style={tab === "open" ? { borderColor: "var(--accent)" } : undefined}>Open · {openCount}</Link>
        <Link href="?status=approved" className={"pb-2 font-mono text-[11px] uppercase tracking-wide " + (tab === "approved" ? "text-ink border-b-2" : "text-clay")} style={tab === "approved" ? { borderColor: "var(--accent)" } : undefined}>Approved · {approvedCount}</Link>
        <Link href="?status=all" className={"pb-2 font-mono text-[11px] uppercase tracking-wide " + (tab === "all" ? "text-ink border-b-2" : "text-clay")} style={tab === "all" ? { borderColor: "var(--accent)" } : undefined}>All</Link>
      </div>

      {safeToApprove.length > 0 && tab === "open" ? (
        <div className="mt-5 border-y border-line py-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Safe to approve ({safeToApprove.length})</p>
          <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Matched to a closed order, no flags. Open Holded → approve. (No API to auto-approve — that step lives in Holded UI.)</p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-10 font-serif italic text-[15px] text-ink-soft">{tab === "open" ? "Inbox empty. Nothing waiting." : "Nothing here."}</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {rows.map((r) => {
            const flag = r.flagged_reason as string | null;
            const tone = flag ? (FLAG_TONE[flag] || "clay") : null;
            const sourceLabel = SOURCE_LABEL[r.source] || r.source;
            const when = new Date(r.arrived_at);
            const days = Math.floor((Date.now() - when.getTime()) / 86400000);
            return (
              <li key={r.id} className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[17px] text-ink">{r.provider?.name || r.supplier_name || "Unknown supplier"}</span>
                  <span className="font-mono text-[12px] text-ink-soft">{eur(r.amount_eur)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{sourceLabel} · {days === 0 ? "today" : days + "d ago"}</span>
                  {flag ? <span className={"font-mono text-[10px] uppercase tracking-wide text-" + tone}>{flag.replace(/_/g, " ")}</span> : null}
                  {r.match_status !== "unmatched" ? <span className="font-mono text-[10px] uppercase tracking-wide text-basil">{r.match_status.replace(/_/g, " ")}</span> : null}
                  {r.vat_eur != null ? <span className="font-mono text-[10px] text-clay">VAT {eur(r.vat_eur)}</span> : null}
                </div>
                {r.notes ? <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{r.notes}</p> : null}
                <div className="mt-2 flex gap-3">
                  {r.holded_doc_id ? <a href={"https://app.holded.com/invoices/purchase/" + r.holded_doc_id} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open in Holded →</a> : null}
                  {r.doc_url ? <a href={r.doc_url} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">View doc →</a> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-12 font-mono text-[10px] uppercase tracking-wide text-clay">Daily scan triage runs 07:06 · pulls unapproved from Holded · flags by rule</p>
    </main>
  );
}
