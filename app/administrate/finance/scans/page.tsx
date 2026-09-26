import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import AssistantContext from "@/components/AssistantContext";
import { SupplierChip } from "@/components/chips";
import { E_BM, E_HOLDINGS, E_TALLER, E_UTOPIA } from "@/lib/entities";
import PushToHolded from "./PushToHolded";
import ScanUpload from "./ScanUpload";
import TriageControls from "./TriageControls";
import { supabaseJob } from "@/lib/supabaseJob";

export const dynamic = "force-dynamic";

// serverEntity() returns the entity uuid (the old slug keys never matched → always IFL).
const ENTITY_CODE: Record<string, string> = { [E_TALLER]: "IFL", [E_BM]: "BM", [E_HOLDINGS]: "BBH", [E_UTOPIA]: "UTOPIA" };
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
  third_party_addressee: "tomato",
  entity_guessed: "tomato",
  totals_dont_reconcile: "tomato",
  low_confidence: "amber",
};
const BAD_FLAGS = new Set(["entity_guessed", "third_party_addressee", "conflicting_copies", "totals_dont_reconcile", "no_supplier_cif", "no_doc_number", "extraction_failed", "multipage_incomplete"]);

export default async function Scans({ searchParams }: { searchParams: { status?: string; supplier?: string; id?: string; ent?: string } }) {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const ec = (searchParams?.ent && ["BM", "IFL", "BBH", "UTOPIA"].includes(searchParams.ent) ? searchParams.ent : ENTITY_CODE[entity]) || "BM";
  const tab = (searchParams?.status || "open") as "open" | "approved" | "all" | "albaranes";

  let query = supabase
    .from("invoice_inbox")
    .select("id,arrived_at,source,source_ref,amount_eur,vat_eur,match_status,flagged_reason,holded_doc_id,doc_url,notes,supplier_name,provider_id,provider:provider_id(name),doc_type,flags,entity_source,vat_bands,invoice_number,document_date,grand_total_eur,addressee_name,addressee_vat_id,conflict_values,vat_issues:ocr_extracted->vat_category_issues")
    .eq("entity_id", ec)
    .order("arrived_at", { ascending: false })
    .limit(100);
  if (tab === "open") query = query.not("match_status", "in", "(approved,rejected,duplicate)");
  else if (tab === "approved") query = query.eq("match_status", "approved");
  // Cross-pillar linking — supplier detail deep-links here with ?supplier=<id>
  if (searchParams?.supplier) query = query.eq("provider_id", searchParams.supplier);
  if (searchParams?.id) query = query.eq("id", searchParams.id);

  const { data: items } = tab === "albaranes" ? { data: [] } : await query;
  const rows: any[] = (items as any[]) || [];

  // Albaranes: stay in the OS (cost basis), never pushed to Holded.
  const { data: albData } = tab === "albaranes"
    ? await supabase.from("albarans")
        .select("id,document_date,supplier_name,doc_number,grand_total_eur,vat_bands,flags,entity_source,match_status,linked_invoice_id,link_method,photo_url,conflict_values,vat_issues:ocr_extracted->vat_category_issues")
        .eq("entity_id", ec).order("document_date", { ascending: false, nullsFirst: false }).limit(200)
    : { data: [] };
  const albs: any[] = (albData as any[]) || [];
  const invIds = rows.map((r) => r.id);
  const { data: linkData } = invIds.length
    ? await supabase.from("albarans").select("id,linked_invoice_id,doc_number,grand_total_eur").in("linked_invoice_id", invIds)
    : { data: [] };
  // Suppliers the funnel created on first sight — look at them once before the
  // first push (Holded often has the same supplier under another spelling).
  const { data: me } = await supabase.auth.getUser();
  const { data: newSup } = me?.user
    ? await supabaseJob().from("controller_suppliers").select("id,name,cif,created_at").like("notes", "created by capture funnel % — review").order("created_at", { ascending: false }).limit(50)
    : { data: [] };
  const linksBy = new Map<string, any[]>();
  for (const l of (linkData as any[]) || []) { const a = linksBy.get(l.linked_invoice_id) || []; a.push(l); linksBy.set(l.linked_invoice_id, a); }

  const openCount = rows.filter((r) => !["approved","rejected","duplicate"].includes(r.match_status)).length;
  const approvedCount = rows.filter((r) => r.match_status === "approved").length;
  const flaggedCount = rows.filter((r) => r.flagged_reason).length;
  const safeToApprove = rows.filter((r) => !r.flagged_reason && r.match_status === "matched_order" && r.amount_eur != null);
  const stuckTotal = rows.filter((r) => !["approved","rejected","duplicate"].includes(r.match_status)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-12">
      <AssistantContext context={{ kind: "invoices", entity: ec, openInvoices: rows.slice(0, 20).map((r) => ({ id: r.id, supplier: r.supplier_name || r.provider?.name || null, amount_eur: r.amount_eur, flagged_reason: r.flagged_reason, match_status: r.match_status })), topId: rows[0]?.id || null }} />
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← dashboard</Link>
      <span className="ml-3 inline-block font-mono text-sm text-clay">Hold Chef to snap a doc.</span>
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
        <Link href="?status=albaranes" className={"pb-2 font-mono text-[11px] uppercase tracking-wide " + (tab === "albaranes" ? "text-ink border-b-2" : "text-clay")} style={tab === "albaranes" ? { borderColor: "var(--accent)" } : undefined}>Albaranes</Link>
      </div>

      <ScanUpload />

      {(newSup as any[] || []).length ? (
        <div className="mt-4 rounded-xl border border-line p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-amber">New suppliers to look at once · {(newSup as any[]).length}</p>
          <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Created from scans. Check none is a supplier you already have under another spelling — confirm each from its invoice's Holded check.</p>
          <ul className="mt-2 space-y-0.5">
            {(newSup as any[]).map((s: any) => <li key={s.id} className="font-mono text-[11px] text-ink-soft">{s.name}{s.cif ? " · " + s.cif : " · no CIF"}</li>)}
          </ul>
        </div>
      ) : null}

      {tab === "albaranes" ? (
        albs.length === 0 ? <p className="mt-10 font-serif italic text-[15px] text-ink-soft">No albaranes captured for {ec} yet.</p> : (
          <ul className="mt-6 divide-y divide-line border-t border-line">
            {albs.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[16px] text-ink">{a.supplier_name || "Unknown supplier"} <span className="font-mono text-[11px] text-ink-soft">{a.doc_number || ""}</span></span>
                  <span className="font-mono text-[12px] text-ink-soft">{eur(a.grand_total_eur)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] uppercase tracking-wide">
                  <span className="text-clay">{a.document_date || "no date"}</span>
                  <span className={a.linked_invoice_id ? "text-basil" : "text-clay"}>{a.linked_invoice_id ? `linked to invoice (${a.link_method})` : a.match_status.replace(/_/g, " ")}</span>
                  {a.entity_source === "session_guess" ? <span className="text-tomato">entity guessed</span> : null}
                  {(a.flags || []).map((f: string) => <span key={f} className={BAD_FLAGS.has(f) ? "text-tomato" : "text-amber"}>{f.replace(/_/g, " ")}</span>)}
                  {a.photo_url ? <a href={a.photo_url} target="_blank" rel="noreferrer" className="text-ink-soft">view →</a> : null}
                </div>
                {a.match_status !== "rejected" ? <TriageControls table="albarans" id={a.id} entityGuessed={a.entity_source === "session_guess"} flags={a.flags || []} issues={a.vat_issues} /> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {safeToApprove.length > 0 && tab === "open" ? (
        <div className="mt-5 border-y border-line py-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Safe to approve ({safeToApprove.length})</p>
          <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Matched to a closed order, no flags. Open Holded → approve. (No API to auto-approve — that step lives in Holded UI.)</p>
        </div>
      ) : null}

      {tab === "albaranes" ? null : rows.length === 0 ? (
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
                  <span className="font-serif text-[17px] text-ink"><SupplierChip id={(r as any).provider_id} name={r.provider?.name || r.supplier_name || "Unknown supplier"} /></span>
                  <span className="font-mono text-[12px] text-ink-soft">{eur(r.amount_eur)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{sourceLabel} · {days === 0 ? "today" : days + "d ago"}</span>
                  {flag ? <span className={"font-mono text-[10px] uppercase tracking-wide text-" + tone}>{flag.replace(/_/g, " ")}</span> : null}
                  {r.match_status !== "unmatched" ? <span className="font-mono text-[10px] uppercase tracking-wide text-basil">{r.match_status.replace(/_/g, " ")}</span> : null}
                  {r.vat_eur != null ? <span className="font-mono text-[10px] text-clay">VAT {eur(r.vat_eur)}</span> : null}
                </div>
                {r.doc_type ? (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide">
                    <span className="text-ink-soft">{r.doc_type}{r.invoice_number ? " · " + r.invoice_number : ""}{r.document_date ? " · " + r.document_date : ""}</span>
                    <span className={r.entity_source === "session_guess" ? "text-tomato" : "text-clay"}>
                      {ec}{r.entity_source === "session_guess" ? " · entity guessed" : r.entity_source ? " · from " + (r.addressee_vat_id || r.addressee_name || "paper") : ""}
                    </span>
                    {(r.flags || []).filter((f: string) => f !== flag).map((f: string) => <span key={f} className={BAD_FLAGS.has(f) ? "text-tomato" : "text-amber"}>{f.replace(/_/g, " ")}</span>)}
                  </div>
                ) : null}
                {Array.isArray(r.vat_bands) && r.vat_bands.length ? (
                  <p className="mt-1 font-mono text-[11px] text-ink-soft">{r.vat_bands.map((b: any) => `${b.rate}%: ${eur(b.base)} + ${eur(b.cuota)}`).join("  ·  ")}</p>
                ) : null}
                {Array.isArray(r.conflict_values) && r.conflict_values.length ? (
                  <p className="mt-1 font-mono text-[11px] text-tomato">Other copies of this number: {r.conflict_values.map((c: any) => eur(c.total) + (c.handwritten_changes ? " (hand-corrected)" : "")).join(", ")} — supplier dispute, not posted.</p>
                ) : null}
                {linksBy.get(r.id)?.length ? (
                  <p className="mt-1 font-mono text-[11px] text-basil">Albaranes: {linksBy.get(r.id)!.map((l: any) => `${l.doc_number || "?"} ${eur(l.grand_total_eur)}`).join(" + ")}</p>
                ) : null}
                {r.notes ? <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{r.notes}</p> : null}
                <div className="mt-2 flex gap-3">
                  {r.holded_doc_id ? <a href={"https://app.holded.com/invoices/purchase/" + r.holded_doc_id} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open in Holded →</a> : null}
                  {r.doc_url ? <a href={r.doc_url} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">View doc →</a> : null}
                </div>
                {r.doc_type && !["rejected", "duplicate", "approved"].includes(r.match_status) ? (
                  <TriageControls table="invoice_inbox" id={r.id} entityGuessed={r.entity_source === "session_guess"} flags={r.flags || []} issues={r.vat_issues} />
                ) : null}
                {r.doc_type === "invoice" && !r.holded_doc_id && !["rejected", "duplicate"].includes(r.match_status) ? (
                  <PushToHolded id={r.id} entity={ec} total={r.grand_total_eur ?? r.amount_eur ?? null} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-12 font-mono text-[10px] uppercase tracking-wide text-clay">Daily scan triage runs 07:06 · pulls unapproved from Holded · flags by rule</p>
    </main>
  );
}
