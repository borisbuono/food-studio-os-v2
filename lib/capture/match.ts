// Albarán ↔ invoice matcher, DB side. Many albaranes → one invoice.
// Pure decision in lib/capture/pure.ts (matchAlbaranes); this file only
// loads candidates and writes the links. A tie is left unmatched.

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchAlbaranes, num } from "@/lib/capture/pure";

export type SupplierMatchReport = { invoices: number; linked: { invoice: string; albaranes: string[]; by: string }[]; ambiguous: string[] };

export async function matchForSupplier(sb: SupabaseClient, entity: string, supplierId: string): Promise<SupplierMatchReport> {
  const report: SupplierMatchReport = { invoices: 0, linked: [], ambiguous: [] };
  const { data: invs } = await sb.from("invoice_inbox")
    .select("id, document_date, grand_total_eur, raw_ocr_text, ocr_extracted")
    .eq("entity_id", entity).eq("supplier_id", supplierId).eq("doc_type", "invoice")
    .in("match_status", ["unmatched"])
    .not("document_date", "is", null)
    .order("document_date");
  const { data: albs } = await sb.from("albarans")
    .select("id, document_date, grand_total_eur, doc_number")
    .eq("entity_id", entity).eq("supplier_id", supplierId)
    .is("linked_invoice_id", null)
    .in("match_status", ["unmatched", "awaiting_invoice", "drop_in"])
    .not("document_date", "is", null);
  let pool = (albs || []).filter((a: any) => num(a.grand_total_eur) !== null)
    .map((a: any) => ({ id: a.id, date: a.document_date, amount: num(a.grand_total_eur)!, doc_no: a.doc_number }));

  for (const inv of (invs || []) as any[]) {
    const amt = num(inv.grand_total_eur);
    if (amt === null) continue;
    report.invoices++;
    const refs: string[] = Array.isArray(inv.ocr_extracted?.referenced_doc_numbers) ? inv.ocr_extracted.referenced_doc_numbers : [];
    const text = [refs.join(" "), inv.raw_ocr_text || ""].join(" ");
    const v = matchAlbaranes({ date: inv.document_date, amount: amt, text }, pool);
    if (v.kind === "ambiguous") { report.ambiguous.push(inv.id); continue; }
    if (v.kind !== "matched") continue;
    const { error } = await sb.from("albarans")
      .update({ linked_invoice_id: inv.id, link_method: v.by, match_status: "matched" })
      .in("id", v.ids).is("linked_invoice_id", null);
    if (error) continue;
    await sb.from("invoice_inbox")
      .update({ match_status: "matched_albaran", linked_albaran_id: v.ids.length === 1 ? v.ids[0] : null })
      .eq("id", inv.id);
    report.linked.push({ invoice: inv.id, albaranes: v.ids, by: v.by });
    pool = pool.filter((p) => !v.ids.includes(p.id));
  }
  return report;
}

export async function matchEntity(sb: SupabaseClient, entity: string) {
  const { data } = await sb.from("invoice_inbox").select("supplier_id")
    .eq("entity_id", entity).eq("doc_type", "invoice").eq("match_status", "unmatched").not("supplier_id", "is", null);
  const ids = Array.from(new Set((data || []).map((r: any) => r.supplier_id as string)));
  const out: Record<string, SupplierMatchReport> = {};
  for (const id of ids) out[id] = await matchForSupplier(sb, entity, id);
  return out;
}
