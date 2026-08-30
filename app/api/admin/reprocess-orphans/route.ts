import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Sonnet vision on 6 photos can take ~60-120s

/**
 * /api/admin/reprocess-orphans
 *
 * One-shot re-processor for the 6 orphan captures Boris took at
 * 2026-08-30 16:06-16:09 CET while signed out. Storage got the JPEGs
 * (bucket `captures` is anon-friendly) but the DB writes were rejected
 * by RLS on invoice_inbox / purchase_lines, so 6 photos have no rows.
 *
 * Auth-gated: requires an authenticated session. The insert then rides
 * that user's JWT under the standard RLS policy, so we don't need a
 * service-role key on the server.
 *
 * GET or POST — Boris hits it once from his phone while signed in.
 */

const ORPHANS = [
  "BM/other/1788106156407.jpeg",
  "BM/invoice/1788106147224.jpeg",
  "BM/invoice/1788106118630.jpeg",
  "BM/invoice/1788106015432.jpeg",
  "BM/other/1788106001654.jpeg",
  "BM/other/1788105982888.jpeg",
];

const BM_RESTAURANT_ID = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";

const EXTRACTION_PROMPT = `You are digitising a Spanish restaurant supplier document.
Classify it and extract every field you can read. Reply ONLY with strict JSON — no prose, no code fences.

Shape (all fields optional, use null when you can't read confidently — never invent):
{
  "type": "invoice" | "albaran" | "eod" | "other",
  "supplier_name": string,
  "supplier_vat_id": string,
  "invoice_number": string,
  "document_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD" | null,
  "payment_method": "cash" | "card" | "transfer" | "sepa" | "other" | null,
  "payment_card_last4": string,
  "payment_iban": string,
  "currency": "EUR",
  "subtotal_eur": number,
  "vat_eur": number,
  "grand_total_eur": number,
  "lines": [
    { "line_number": integer, "product_code": string, "product_name": string,
      "quantity": number, "unit": string, "unit_price_eur": number,
      "discount_pct": number, "line_subtotal_eur": number, "vat_rate": number,
      "vat_amount_eur": number, "line_total_eur": number, "confidence": number }
  ],
  "raw_ocr_text": string,
  "extraction_confidence": {
    "supplier_name": number, "invoice_number": number, "document_date": number,
    "grand_total_eur": number, "subtotal_eur": number, "vat_eur": number
  }
}

Classification: invoice=factura, albaran=nota de entrega, eod=Z/cierre de caja, other=anything else.
Numbers: comma decimals become dot decimals; VAT rate is integer %; never invent.`;

function n(v: any) { if (v === null || v === undefined || v === "") return null; const x = typeof v === "number" ? v : Number(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; }
function s(v: any) { if (v === null || v === undefined) return null; const t = String(v).trim(); return t === "" ? null : t; }
function d(v: any) { const t = s(v); return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; }

async function extractWithSonnet(base64: string, mediaType: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false as const, error: "ANTHROPIC_API_KEY missing" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "Extract this document and return the JSON described." },
      ] }],
    }),
  });
  if (!r.ok) return { ok: false as const, error: `sonnet ${r.status}: ${(await r.text()).slice(0, 300)}` };
  const j = await r.json();
  const text: string = j?.content?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false as const, error: "no JSON in reply" };
  try { return { ok: true as const, data: JSON.parse(m[0]) }; }
  catch (e: any) { return { ok: false as const, error: "JSON parse: " + e?.message }; }
}

async function handle() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not signed in — visit /login first" }, { status: 401 });
  }

  const results: any[] = [];
  for (const path of ORPHANS) {
    const dl = await sb.storage.from("captures").download(path);
    if (dl.error || !dl.data) {
      results.push({ path, ok: false, error: "download: " + dl.error?.message });
      continue;
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const b64 = buf.toString("base64");
    const ext = await extractWithSonnet(b64, "image/jpeg");
    if (!ext.ok) {
      results.push({ path, ok: false, error: ext.error });
      continue;
    }
    const e = ext.data as any;
    const type = ["invoice", "albaran", "eod", "other"].includes(e.type) ? e.type : "other";
    const arrivedAt = d(e.document_date) ? d(e.document_date) + "T00:00:00Z" : new Date().toISOString();
    const signed = await sb.storage.from("captures").createSignedUrl(path, 60 * 60 * 24 * 30);

    const inboxRow: Record<string, any> = {
      entity_id: "BM",
      restaurant_id: BM_RESTAURANT_ID,
      source: "paper_photo",
      arrived_at: arrivedAt,
      doc_url: signed.data?.signedUrl || null,
      storage_path: path,
      doc_type: type,
      supplier_name: s(e.supplier_name),
      supplier_vat_id: s(e.supplier_vat_id),
      invoice_number: s(e.invoice_number),
      document_date: d(e.document_date),
      due_date: d(e.due_date),
      payment_method: s(e.payment_method),
      payment_card_last4: s(e.payment_card_last4),
      payment_iban: s(e.payment_iban),
      currency: s(e.currency) || "EUR",
      subtotal_eur: n(e.subtotal_eur),
      vat_eur: n(e.vat_eur),
      grand_total_eur: n(e.grand_total_eur),
      amount_eur: n(e.grand_total_eur),
      extraction_confidence: e.extraction_confidence || null,
      raw_ocr_text: s(e.raw_ocr_text),
      extraction_model: "claude-sonnet-4-5-20250929",
      extraction_at: new Date().toISOString(),
      ocr_extracted: e,
      match_status: "unmatched",
      notes: `reprocessed 2026-08-30 · Boris orphan sweep · ${(e.lines || []).length} lines`,
    };

    const up = await sb.from("invoice_inbox").upsert(inboxRow, { onConflict: "storage_path" }).select("id").maybeSingle();
    if (up.error) {
      results.push({ path, ok: false, error: "inbox: " + up.error.message });
      continue;
    }
    const inboxId = up.data?.id;
    const rawLines = Array.isArray(e.lines) ? e.lines : [];
    let linesInserted = 0;
    if (inboxId && rawLines.length > 0 && (type === "invoice" || type === "albaran")) {
      await sb.from("purchase_lines").delete().eq("invoice_inbox_id", inboxId);
      const rows = rawLines.map((ln: any, idx: number) => ({
        invoice_inbox_id: inboxId,
        entity_code: "BM",
        restaurant_id: BM_RESTAURANT_ID,
        doc_date: d(e.document_date),
        doc_ref: s(e.invoice_number),
        line_number: Number.isFinite(ln.line_number) ? ln.line_number : idx + 1,
        product_code: s(ln.product_code),
        raw_product_text: s(ln.product_name),
        qty: n(ln.quantity),
        unit: s(ln.unit),
        unit_price_eur: n(ln.unit_price_eur),
        discount_pct: n(ln.discount_pct),
        line_subtotal_eur: n(ln.line_subtotal_eur),
        vat_rate: n(ln.vat_rate),
        vat_amount_eur: n(ln.vat_amount_eur),
        line_total_eur: n(ln.line_total_eur),
        confidence: n(ln.confidence),
        source: "capture_rich_reprocess",
        imported_at: new Date().toISOString(),
      }));
      const ins = await sb.from("purchase_lines").insert(rows, { count: "exact" });
      if (!ins.error) linesInserted = ins.count || rows.length;
    }

    results.push({
      path,
      ok: true,
      inbox_id: inboxId,
      type,
      supplier: e.supplier_name || null,
      supplier_vat_id: e.supplier_vat_id || null,
      invoice_number: e.invoice_number || null,
      document_date: e.document_date || null,
      grand_total_eur: e.grand_total_eur ?? null,
      lines_printed: rawLines.length,
      lines_stored: linesInserted,
      extraction_confidence: e.extraction_confidence || null,
    });
  }

  return NextResponse.json({ ok: true, user: user.email, count: results.length, results });
}

export async function GET() { return handle(); }
export async function POST() { return handle(); }
