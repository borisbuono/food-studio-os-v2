// Tickets (facturas simplificadas) ↔ full facturas, and where each ticket
// stands (BUILD_PROMPT §11–13). DB side; decisions live in lib/capture/pure.
//
// Order the prompt insists on — never chase before looking:
//   1. is the factura already in the OS? (a factura citing the ticket number)
//   2. does the supplier bill monthly / through someone else (Solred → CaixaBank)?
//   3. are we already their client? → ask for the factura
//   4. not a client → register our fiscal details + ask
//   5. impossible → not_obtainable (non-deductible), set by a human

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseJob } from "@/lib/supabaseJob";
import { ticketMatch, ticketStatus, normTaxId, num, type FacturaStatus } from "@/lib/capture/pure";

type TicketRow = {
  id: string; entity_id: string; entity_source: string | null; supplier_id: string | null; supplier_vat_id: string | null;
  ticket_number: string | null; document_date: string | null; grand_total_eur: number | null; factura_status: string | null;
  flags: string[] | null; triage_log: any; linked_factura_id: string | null;
};
const TCOLS = "id, entity_id, entity_source, supplier_id, supplier_vat_id, ticket_number, document_date, grand_total_eur, factura_status, flags, triage_log, linked_factura_id";

const sameMoney = (a: unknown, b: unknown) => num(a) !== null && num(b) !== null && Math.abs(num(a)! - num(b)!) <= 0.01;

// A factura just landed: link every ticket it cites. The factura carries our
// fiscal details, so it also settles the ticket's entity.
export async function linkTicketsForFactura(sb: SupabaseClient, factura: {
  id: string; entity_id: string; entity_source: string; supplier_vat_id: string | null; document_date: string | null;
  grand_total_eur: number | null; refs: string[];
}): Promise<{ linked: string[]; corrected: { id: string; from: string; to: string }[] }> {
  const out = { linked: [] as string[], corrected: [] as { id: string; from: string; to: string }[] };
  if (!factura.refs.length) return out;
  let q = sb.from("invoice_inbox").select(TCOLS).eq("doc_type", "ticket").is("linked_factura_id", null).not("ticket_number", "is", null).limit(300);
  const cif = normTaxId(factura.supplier_vat_id);
  if (cif) q = q.eq("supplier_vat_id", cif);
  const { data } = await q;
  for (const t of (data || []) as TicketRow[]) {
    for (const ref of factura.refs) {
      const m = ticketMatch(t.ticket_number, ref);
      if (!m) continue;
      // one-character difference: only when the money agrees too (one factura may cover
      // several tickets, so the total check is per-ticket against its own amount on the factura
      // text — here we require the single-ticket case to agree, else leave for a human)
      if (m === "one_off" && !(factura.refs.length === 1 && sameMoney(t.grand_total_eur, factura.grand_total_eur))) continue;
      const log = Array.isArray(t.triage_log) ? t.triage_log : [];
      const patch: Record<string, unknown> = {
        linked_factura_id: factura.id, factura_status: "resolved",
        flags: (t.flags || []).filter((f) => f !== "entity_guessed"),
        triage_log: [...log, { at: new Date().toISOString(), by: "capture_funnel", action: "ticket_resolved_by_factura", factura: factura.id,
          ...(m === "one_off" ? { corrected_ticket_number: { from: t.ticket_number, to: ref, why: "factura prints it digitally; same total" } } : {}),
          ...(t.entity_source === "session_guess" ? { entity: { from: t.entity_id, to: factura.entity_id, why: "factura addressed to it cites this ticket" } } : {}) }],
      };
      if (m === "one_off") { patch.ticket_number = ref; out.corrected.push({ id: t.id, from: String(t.ticket_number), to: ref }); }
      if (t.entity_source === "session_guess" && factura.entity_source.startsWith("document")) { patch.entity_id = factura.entity_id; patch.entity_source = "via_factura"; }
      await sb.from("invoice_inbox").update(patch).eq("id", t.id);
      // The factura's lines are the cost basis now; drop any lines the ticket carried.
      await sb.from("purchase_lines").delete().eq("invoice_inbox_id", t.id);
      out.linked.push(t.id);
      break;
    }
  }
  return out;
}

// A ticket just landed (or something changed): decide its status.
export async function refreshTicketStatus(sb: SupabaseClient, ticketId: string): Promise<FacturaStatus | null> {
  const { data: t } = await sb.from("invoice_inbox").select(TCOLS).eq("id", ticketId).maybeSingle();
  if (!t) return null;
  const row = t as TicketRow;
  if (row.factura_status === "not_obtainable" || row.factura_status === "awaiting_factura") return row.factura_status as FacturaStatus;

  // 1. factura already in the OS citing this ticket?
  let hasFactura = !!row.linked_factura_id;
  if (!hasFactura && row.ticket_number) {
    let q = sb.from("invoice_inbox").select("id, entity_id, entity_source, supplier_vat_id, document_date, grand_total_eur, ocr_extracted")
      .eq("doc_type", "invoice").limit(300);
    const cif = normTaxId(row.supplier_vat_id);
    if (cif) q = q.eq("supplier_vat_id", cif);
    const { data: facts } = await q;
    for (const f of (facts || []) as any[]) {
      const refs: string[] = Array.isArray(f.ocr_extracted?.referenced_ticket_numbers) ? f.ocr_extracted.referenced_ticket_numbers : [];
      if (refs.some((r) => ticketMatch(row.ticket_number, r))) {
        const res = await linkTicketsForFactura(sb, { id: f.id, entity_id: f.entity_id, entity_source: f.entity_source || "", supplier_vat_id: f.supplier_vat_id, document_date: f.document_date, grand_total_eur: f.grand_total_eur, refs });
        if (res.linked.includes(row.id)) return "resolved";
      }
    }
  }

  // 2–4. supplier facts
  // Paid with a fuel/scheme card (Solred): the factura comes from the card issuer
  // (CaixaBank) monthly — never chase the station. Per ticket, not per supplier.
  let consolidated = (row.flags || []).includes("billed_via_card_scheme"), isClient = false;
  if (row.supplier_id) {
    const { data: sup } = await supabaseJob().from("controller_suppliers").select("billing_mode, invoice_issued_by, registered_for").eq("id", row.supplier_id).maybeSingle();
    consolidated = consolidated || (sup as any)?.billing_mode === "consolidated_monthly";
    isClient = !!((sup as any)?.registered_for || {})[row.entity_id];
    if (!isClient) {
      const { count } = await sb.from("invoice_inbox").select("id", { count: "exact", head: true })
        .eq("supplier_id", row.supplier_id).eq("entity_id", row.entity_id).eq("doc_type", "invoice").like("entity_source", "document%");
      isClient = (count || 0) > 0;
    }
  }
  const status = ticketStatus({ hasFactura, consolidated, isClient, requested: false, impossible: false });
  await sb.from("invoice_inbox").update({ factura_status: status }).eq("id", row.id);
  return status;
}

// How many tickets without our details this supplier has produced for this entity.
// From the third on, the fix is to register our CIF with them once (§13 standing fix).
export async function ticketsWithoutDetails(sb: SupabaseClient, supplierId: string, entity: string): Promise<number> {
  const { count } = await sb.from("invoice_inbox").select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId).eq("entity_id", entity).eq("doc_type", "ticket");
  return count || 0;
}

// Fill blanks on the supplier record from what the paper prints. Never overwrites.
export async function enrichSupplierFromDoc(supplierId: string, contact: { email?: string | null; phone?: string | null; address?: string | null; website?: string | null } | null | undefined) {
  const job = supabaseJob();
  const { data: sup } = await job.from("controller_suppliers").select("email, phone, address, website, enrichment, invoice_issued_by, billing_mode").eq("id", supplierId).maybeSingle();
  if (!sup) return;
  const patch: Record<string, unknown> = {};
  for (const k of ["email", "phone", "address", "website"] as const) {
    const v = (contact as any)?.[k];
    if (v && !(sup as any)[k]) patch[k] = String(v).trim().slice(0, 300);
  }
  if (Object.keys(patch).length) {
    const en = (sup as any).enrichment || {};
    patch.enrichment = { ...en, from_document: { ...(en.from_document || {}), ...patch, at: new Date().toISOString() } };
    await job.from("controller_suppliers").update(patch).eq("id", supplierId);
  }
}
