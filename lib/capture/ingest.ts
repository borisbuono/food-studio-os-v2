// Capture funnel — one paper document in, one OS row out. Server-only.
//
//   file ─▶ sha256 (idempotent re-scan) ─▶ Claude (PDF or image)
//        ─▶ entity FROM THE ADDRESSEE (never the session)
//        ─▶ supplier by CIF ─▶ dedup (CIF + doc no + total)
//        ─▶ storage captures/<ENTITY>/<type>/… ─▶ invoice_inbox | albarans
//        ─▶ purchase_lines (arithmetic-checked) ─▶ albarán↔invoice matcher
//
// Nothing here talks to Holded. The push is lib/capture/holded.ts and only
// runs on a human tick, one document at a time.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseJob } from "@/lib/supabaseJob";
import { requireManagerOf } from "@/lib/access/requireManager";
import { recomputeAfterIngest } from "@/lib/recipes/recompute";
import { extractDocument, EXTRACTION_MODEL, type Extracted } from "@/lib/capture/extract";
import { matchForSupplier } from "@/lib/capture/match";
import { linkTicketsForFactura, refreshTicketStatus, enrichSupplierFromDoc } from "@/lib/capture/tickets";
import {
  resolveEntityFromDoc, normTaxId, normDocNo, normName, normaliseBands, bandTotals, checkLines, lineArithmeticOk,
  docTypeFromWord, dedup, num, r2, vatCategoryCheck, supplierCountry, type Line, type EntityCode, type OwnEntity, type DocType, type PriorDoc,
} from "@/lib/capture/pure";

// Entity slug → the text code the finance tables key on. The CIFs themselves
// come from entities.tax_id (no static CIF map).
const SLUG_CODE: Record<string, EntityCode> = { bm: "BM", taller: "IFL", holdings: "BBH", utopia: "UTOPIA" };
const CODE_RESTAURANT: Partial<Record<EntityCode, string>> = {
  BM: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  UTOPIA: "a0000000-0000-4000-8000-000000000001",
};
const LOW_CONFIDENCE = 0.85;

export type IngestResult =
  | { ok: true; status: "filed" | "needs_triage" | "rejected"; table: "invoice_inbox" | "albarans"; id: string; entity: EntityCode;
      entity_source: string; doc_type: DocType; flags: string[]; lines: number; matched?: unknown; ticket?: unknown; extraction_error?: string | null }
  | { ok: true; status: "already_captured" | "duplicate"; table: "invoice_inbox" | "albarans"; id: string; reason: string }
  | { ok: true; status: "conflicting_copies"; table: "invoice_inbox" | "albarans"; id: string; prior_total: number | null; this_total: number | null }
  | { ok: false; status: number; error: string };

async function ownEntities(job: SupabaseClient): Promise<OwnEntity[]> {
  const { data } = await job.from("entities").select("slug, tax_id, legal_name").in("slug", Object.keys(SLUG_CODE));
  return (data || []).map((e: any) => ({ code: SLUG_CODE[e.slug], tax_id: e.tax_id, legal_name: e.legal_name }));
}

// CIF first, name second. A name hit with a DIFFERENT CIF is never merged.
async function resolveSupplier(job: SupabaseClient, name: string | null, cifRaw: string | null): Promise<{ id: string | null; flags: string[] }> {
  const cif = normTaxId(cifRaw);
  const flags: string[] = [];
  if (!name && !cif) return { id: null, flags: ["no_supplier"] };
  const { data: all } = await job.from("controller_suppliers").select("id, name, cif");
  const rows = (all || []) as { id: string; name: string; cif: string | null }[];
  if (cif) {
    const hit = rows.find((r) => normTaxId(r.cif) === cif);
    if (hit) return { id: hit.id, flags };
  }
  const nm = normName(name);
  const byName = nm ? rows.find((r) => normName(r.name) === nm) : undefined;
  if (byName) {
    if (!byName.cif && cif) {
      await job.from("controller_suppliers").update({ cif }).eq("id", byName.id).is("cif", null);
      return { id: byName.id, flags: ["supplier_cif_filled"] };
    }
    if (!cif || normTaxId(byName.cif) === cif) return { id: byName.id, flags };
    flags.push("supplier_cif_conflict");
  }
  const base = String(name || cif || "Unknown").trim().toUpperCase().slice(0, 80);
  const newName = byName ? `${base} (${cif})` : base;
  const { data: ins, error } = await job.from("controller_suppliers")
    .insert({ name: newName, cif, notes: `created by capture funnel ${new Date().toISOString().slice(0, 10)} — review` })
    .select("id").maybeSingle();
  if (error || !ins) {
    // name collision race — take whoever holds the name
    const { data: again } = await job.from("controller_suppliers").select("id").eq("name", newName).maybeSingle();
    return { id: (again as any)?.id || null, flags: [...flags, "new_supplier"] };
  }
  return { id: (ins as any).id, flags: [...flags, "new_supplier"] };
}

const s = (v: unknown) => { const t = v == null ? "" : String(v).trim(); return t || null; };
const iso = (v: unknown) => { const t = s(v); return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

export async function ingestCapture(args: {
  sb: SupabaseClient;            // request-bound client (RLS as the user)
  uid: string;
  buf: ArrayBuffer;
  mediaType: string;
  filename?: string | null;
  sessionCode: EntityCode;       // only used when the paper can't tell us
  source?: "paper_photo" | "manual_upload";
}): Promise<IngestResult> {
  const { sb, buf, mediaType } = args;
  const job = supabaseJob();
  const sha = createHash("sha256").update(Buffer.from(new Uint8Array(buf))).digest("hex");

  // 0) Same bytes already captured → return that row.
  for (const table of ["invoice_inbox", "albarans"] as const) {
    const { data } = await sb.from(table).select("id").eq("file_sha256", sha).limit(1).maybeSingle();
    if (data) return { ok: true, status: "already_captured", table, id: (data as any).id, reason: "same file bytes" };
  }

  // 1) Read the paper.
  const ext = await extractDocument(buf, mediaType);
  const x: Extracted = ext.ok ? ext.data : {};
  const extractionError = ext.ok ? null : ext.error;
  const flags: string[] = [];
  if (!ext.ok) flags.push("extraction_failed");

  // 2) Entity from the addressee.
  const verdict = resolveEntityFromDoc({ vat_id: x.addressee_vat_id, name: x.addressee_name }, await ownEntities(job));
  let entity: EntityCode = args.sessionCode;
  let entitySource = "session_guess";
  let status: "filed" | "needs_triage" | "rejected" = "filed";
  if (verdict.kind === "document") {
    entity = verdict.code; entitySource = verdict.by === "cif" ? "document_cif" : "document_name";
    if (verdict.cifMisread) flags.push("addressee_cif_misread");
  }
  else if (verdict.kind === "third_party") { flags.push("third_party_addressee"); status = "rejected"; }
  else { flags.push("entity_guessed"); status = "needs_triage"; }

  const gate = await requireManagerOf(sb, entity);
  if (!gate.ok) return { ok: false, status: gate.status, error: `${gate.error} (document is addressed to ${entity})` };

  // 3) Type, VAT bands, totals, lines.
  let docType = docTypeFromWord(x.doc_word, x.model_type);
  // §11: what makes a factura is OUR fiscal details on it, not a VAT breakdown.
  if (docType === "invoice" && x.customer_details_present === false) { docType = "ticket"; }
  if (docType === "ticket" && x.customer_details_present === true && verdict.kind === "document") docType = "invoice"; // simplificada cualificada
  if (docType === "ticket") flags.push("no_customer_details");
  if (docType === "ticket" && /SOLRED/i.test(String(x.payment_card_scheme || "") + " " + String(x.raw_ocr_text || ""))) flags.push("billed_via_card_scheme");
  const { bands, flags: bandFlags } = normaliseBands(x.vat_bands);
  flags.push(...bandFlags);
  // EU supplier outside Spain: foreign VAT, or an intra-community purchase to self-assess.
  // GGM Gastro (DE) was booked at tax 0 both ways — that call belongs to the accountant.
  const sc = supplierCountry(x.supplier_vat_id);
  if (sc.country && sc.country !== "ES") {
    flags.push(sc.eu ? "eu_supplier" : "non_eu_supplier");
    const explicit = bands.every((b) => ["intra_goods", "intra_services", "import", "foreign_vat", "exempt", "not_subject"].includes(b.regime || "iva"));
    if (!explicit || !bands.length) flags.push("tax_regime_needs_accountant");
  }
  const hdrBase = num(x.subtotal_eur), hdrVat = num(x.vat_eur), hdrTotal = num(x.grand_total_eur);
  const bt = bandTotals(bands);
  const total = hdrTotal ?? (bands.length ? bt.total : null);
  if (bands.length && total !== null && Math.abs(bt.total - total) > 0.05) flags.push("totals_dont_reconcile");
  if (!bands.length && (docType === "invoice" || docType === "ticket")) flags.push("no_vat_bands");
  const rawLines = Array.isArray(x.lines) ? x.lines : [];
  // Lines must add up to the base of ALL tax bands. The printed "subtotal" can
  // leave out a small 21 % item (Viapa 260023946: 108,00 printed, bands 109,80).
  const lc = checkLines(rawLines, bands.length ? bt.base : hdrBase);
  flags.push(...lc.flags);
  const conf = num(x.confidence);
  if (conf !== null && conf < LOW_CONFIDENCE) { flags.push("low_confidence"); if (status === "filed") status = "needs_triage"; }
  if (x.handwritten_changes) flags.push("handwritten_changes");
  const pl = String(x.page_label || "").match(/(\d+)\s*(?:de|of|\/)\s*(\d+)/i);
  if (pl && Number(pl[2]) > Math.max(1, Number(x.pages_seen || 1))) flags.push("multipage_incomplete");
  const vatIssues = vatCategoryCheck({ supplier_name: x.supplier_name, lines: lc.keep, bands });
  if (vatIssues.length) flags.push("vat_rate_category_mismatch");
  if (!normTaxId(x.supplier_vat_id)) flags.push("no_supplier_cif");
  if (!normDocNo(x.doc_number)) flags.push("no_doc_number");

  // 4) Supplier.
  const sup = status === "rejected" ? { id: null, flags: [] as string[] } : await resolveSupplier(job, s(x.supplier_name), s(x.supplier_vat_id));
  flags.push(...sup.flags);
  const supplierCif = normTaxId(x.supplier_vat_id);
  const table = docType === "albaran" ? "albarans" : "invoice_inbox";
  const docNoCol = table === "albarans" ? "doc_number" : "invoice_number";
  const totalCol = "grand_total_eur";

  // 5) Storage (under the entity the PAPER names).
  const ts = Date.now();
  const storagePath = `${entity}/${docType}/${ts}-${sha.slice(0, 8)}.${EXT[mediaType] || "bin"}`;

  // 6) Dedup on (supplier CIF + doc no + total).
  if (supplierCif && normDocNo(x.doc_number) && status !== "rejected") {
    const { data: priorRows } = await sb.from(table)
      .select(`id, supplier_vat_id, ${docNoCol}, ${totalCol}, conflict_values, flags`)
      .eq("supplier_vat_id", supplierCif).limit(500);
    const prior: PriorDoc[] = (priorRows || []).map((r: any) => ({
      id: r.id, supplier_cif: r.supplier_vat_id, doc_no: r[docNoCol], total: num(r[totalCol]),
      alt_totals: (Array.isArray(r.conflict_values) ? r.conflict_values : []).map((c: any) => num(c?.total)).filter((t: any) => t !== null),
    }));
    const dv = dedup({ supplier_cif: supplierCif, doc_no: x.doc_number || null, total }, prior);
    if (dv.kind === "duplicate") return { ok: true, status: "duplicate", table, id: dv.of, reason: "same supplier CIF + doc number + total" };
    if (dv.kind === "conflict") {
      // Keep the evidence: store this copy's file and values on the ONE record.
      await sb.storage.from("captures").upload(storagePath, buf, { contentType: mediaType, upsert: false });
      const row: any = (priorRows || []).find((r: any) => r.id === dv.of);
      const cv = Array.isArray(row?.conflict_values) ? row.conflict_values : [];
      cv.push({ total, base: hdrBase, vat: hdrVat, storage_path: storagePath, file_sha256: sha, handwritten_changes: !!x.handwritten_changes, captured_at: new Date().toISOString() });
      const f = Array.from(new Set([...(row?.flags || []), "conflicting_copies"]));
      await sb.from(table).update({ conflict_values: cv, flags: f, match_status: "conflicting_copies" }).eq("id", dv.of);
      return { ok: true, status: "conflicting_copies", table, id: dv.of, prior_total: dv.prior_total, this_total: total };
    }
  }

  const up = await sb.storage.from("captures").upload(storagePath, buf, { contentType: mediaType, upsert: false });
  if (up.error) return { ok: false, status: 500, error: "storage: " + up.error.message };
  const signed = await sb.storage.from("captures").createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  const docUrl = signed.data?.signedUrl || null;

  // 7) The row.
  const docDate = iso(x.document_date);
  const uniqFlags = Array.from(new Set(flags));
  const common = {
    entity_id: entity,
    restaurant_id: CODE_RESTAURANT[entity] || null,
    supplier_id: sup.id,
    supplier_name: s(x.supplier_name),
    supplier_vat_id: supplierCif || s(x.supplier_vat_id),
    document_date: docDate,
    subtotal_eur: bands.length ? bt.base : hdrBase,
    vat_eur: bands.length ? bt.vat : hdrVat,           // vat_eur is the SUM of the bands
    grand_total_eur: total,
    vat_bands: bands.length ? bands : null,
    storage_path: storagePath,
    entity_source: entitySource,
    addressee_vat_id: s(x.addressee_vat_id),
    flags: uniqFlags,
    file_sha256: sha,
    raw_ocr_text: s(x.raw_ocr_text),
    ocr_extracted: { ...x, extraction_error: extractionError, entity_verdict: verdict, vat_category_issues: vatIssues, filename: args.filename || null } as any,
  };
  let id: string;
  if (table === "albarans") {
    const { data, error } = await sb.from("albarans").insert({
      ...common,
      received_at: docDate ? docDate + "T00:00:00Z" : new Date().toISOString(),
      received_by: args.uid,
      photo_url: docUrl,
      doc_number: s(x.doc_number),
      extraction_confidence: conf,
      match_status: status === "rejected" ? "rejected" : status === "needs_triage" ? "needs_triage" : "unmatched",
      notes: `capture funnel · ${x.doc_word || "albarán"}${args.filename ? " · " + args.filename : ""}`,
    }).select("id").single();
    if (error || !data) return { ok: false, status: 500, error: "albarans insert: " + (error?.message || "no row") };
    id = (data as any).id;
  } else {
    const { data, error } = await sb.from("invoice_inbox").insert({
      ...common,
      source: args.source || "paper_photo",
      arrived_at: docDate ? docDate + "T00:00:00Z" : new Date().toISOString(),
      doc_url: docUrl,
      doc_type: docType,
      invoice_number: s(x.doc_number),
      addressee_name: s(x.addressee_name),
      ticket_number: docType === "ticket" ? s(x.simplified_invoice_number) || s(x.doc_number) : null,
      customer_details_present: typeof x.customer_details_present === "boolean" ? x.customer_details_present : null,
      factura_status: docType === "ticket" ? "unchecked" : null,
      due_date: iso(x.due_date),
      payment_method: s(x.payment_method),
      payment_card_last4: s(x.payment_card_last4),
      payment_iban: s(x.payment_iban),
      currency: "EUR",
      amount_eur: total,
      page_count: num(x.pages_seen),
      extraction_confidence: x.extraction_confidence || (conf !== null ? { overall: conf } : null),
      extraction_model: EXTRACTION_MODEL,
      extraction_at: new Date().toISOString(),
      match_status: status === "rejected" ? "rejected" : status === "needs_triage" ? "needs_triage" : "unmatched",
      flagged_reason: uniqFlags.find((f) => ["third_party_addressee", "entity_guessed", "totals_dont_reconcile", "low_confidence"].includes(f)) || null,
      notes: `capture funnel · ${x.doc_word || docType}${args.filename ? " · " + args.filename : ""}`,
    }).select("id").single();
    if (error || !data) return { ok: false, status: 500, error: "invoice_inbox insert: " + (error?.message || "no row") };
    id = (data as any).id;
  }

  // 8) Lines → purchase_lines. Only when the entity came off the paper: a
  //    guessed entity would feed the wrong venue's recipe costs.
  let linesWritten = 0;
  if (status === "filed" && entitySource !== "session_guess" && (docType === "invoice" || docType === "albaran" || docType === "ticket")) {
    linesWritten = await writeLines(sb, {
      table, id, entity, supplierId: sup.id, docDate, docRef: s(x.doc_number), lines: lc.keep,
    });
    if (linesWritten < 0) { await sb.from(table).update({ flags: [...uniqFlags, "lines_not_saved"] }).eq("id", id); linesWritten = 0; }
  }

  // 8b) Supplier record: fill blanks from what the paper prints (§13).
  if (sup.id && status !== "rejected") { try { await enrichSupplierFromDoc(sup.id, x.supplier_contact); } catch { /* best-effort */ } }

  // 8c) Tickets ↔ facturas (§11–12).
  let ticket: unknown = null;
  if (table === "invoice_inbox" && status !== "rejected") {
    try {
      if (docType === "ticket") ticket = { status: await refreshTicketStatus(sb, id) };
      else if (docType === "invoice") {
        const refs = (Array.isArray(x.referenced_ticket_numbers) ? x.referenced_ticket_numbers : []).map(String).filter(Boolean);
        if (refs.length) ticket = await linkTicketsForFactura(sb, { id, entity_id: entity, entity_source: entitySource, supplier_vat_id: supplierCif, document_date: docDate, grand_total_eur: total, refs });
      }
    } catch (e: any) { ticket = { error: String(e?.message || e) }; }
  }

  // 9) Albarán ↔ invoice links for this supplier.
  let matched: unknown = null;
  if (status === "filed" && sup.id && (docType === "invoice" || docType === "albaran")) {
    try { matched = await matchForSupplier(sb, entity, sup.id); } catch (e: any) { matched = { error: String(e?.message || e) }; }
  }

  return { ok: true, status, table, id, entity, entity_source: entitySource, doc_type: docType, flags: uniqFlags, lines: linesWritten, matched, ticket, extraction_error: extractionError };
}

// purchase_lines for one captured document. Returns rows written, −1 on error.
// Also used by triage once a guessed entity has been confirmed by a human.
export async function writeLines(sb: SupabaseClient, a: {
  table: "invoice_inbox" | "albarans"; id: string; entity: EntityCode; supplierId: string | null;
  docDate: string | null; docRef: string | null; lines: Line[];
}): Promise<number> {
  if (!a.lines.length) return 0;
  const rows = a.lines.map((l, i) => {
    const sub = num(l.line_subtotal_eur), rate = num(l.vat_rate);
    return {
      entity_code: a.entity,
      restaurant_id: CODE_RESTAURANT[a.entity] || null,
      supplier_id: a.supplierId,
      invoice_inbox_id: a.table === "invoice_inbox" ? a.id : null,
      albaran_id: a.table === "albarans" ? a.id : null,
      doc_date: a.docDate,
      doc_ref: a.docRef,
      line_number: Number(l.line_number) || i + 1,
      product_code: s(l.product_code),
      raw_product_text: s(l.product_name),
      qty: num(l.quantity),
      unit: s(l.unit),
      unit_price_eur: num(l.unit_price_eur),
      discount_pct: num(l.discount_pct),
      line_subtotal_eur: sub,
      vat_rate: rate,
      vat_amount_eur: num(l.vat_amount_eur),
      line_total_eur: num(l.line_total_eur) ?? (sub !== null && rate !== null ? r2(sub * (1 + rate / 100)) : null),
      confidence: num(l.confidence),
      arithmetic_ok: lineArithmeticOk(l),
      source: "capture_funnel",
      imported_at: new Date().toISOString(),
    };
  });
  const { error } = await sb.from("purchase_lines").insert(rows);
  if (error) return -1;
  if (a.entity !== "BBH") {
    try { await recomputeAfterIngest(sb, a.entity, a.lines.map((l) => s(l.product_name))); } catch { /* best-effort */ }
  }
  return rows.length;
}
