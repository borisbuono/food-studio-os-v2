import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/capture/rich — the Capture Station's engine.
//
// One-pass Sonnet-4.5 vision extraction. Boris asked for the option of a
// two-pass (Haiku classify → Sonnet extract) approach, but the extra hop
// only saves cost on non-invoice shots; the marginal cost is a few cents
// and the wall-clock cost is ~1s per image, which matters when Boris is
// standing at receiving with a stack of 20. We go direct to Sonnet and
// have it also classify. If the doc is "other" we still write an inbox
// row so nothing is lost — Boris can retag later.
//
// Writes:
//   - storage:            captures/<entity>/<type>/<ts>.<ext>
//   - invoice_inbox:      one row per photo, header fields + raw_ocr_text
//                         + extraction_confidence (idempotent on storage_path)
//   - purchase_lines:     one row per line item (idempotent on
//                         (invoice_inbox_id, line_number))
//
// The old /api/capture route is preserved so the AssistantFab camera path
// keeps working; this endpoint lives alongside it.

const ENTITY_CODE: Record<EntityKey, string> = {
  taller: "IFL",
  bistro_mondo: "BM",
  holdings: "BBH",
};

// The prompt. Written to be recoverable — if a field can't be read we want
// `null`, never a hallucinated number. Confidence is per-field (0..1) so
// the UI can render low-confidence fields in orange.
const EXTRACTION_PROMPT = `You are digitising a Spanish restaurant supplier document.
Classify it and extract every field you can read. Reply ONLY with strict JSON — no prose, no code fences.

Shape (all fields optional, use null when you can't read confidently — never invent):
{
  "type": "invoice" | "albaran" | "eod" | "other",
  "supplier_name": string,
  "supplier_vat_id": string,        // CIF / NIF / VAT ID (Spanish: B12345678 / X1234567X / ESB12345678)
  "invoice_number": string,         // "Factura Nº", "Nº Doc", the reference the supplier prints
  "document_date": "YYYY-MM-DD",    // date on the doc, not today
  "due_date": "YYYY-MM-DD" | null,  // "Vto." / "Fecha vencimiento" — null if paid on delivery
  "payment_method": "cash" | "card" | "transfer" | "sepa" | "other" | null,
  "payment_card_last4": string,     // last 4 digits if a card slip is shown
  "payment_iban": string,           // if IBAN is printed
  "currency": "EUR",
  "subtotal_eur": number,           // sum of lines before VAT (base imponible)
  "vat_eur": number,                // VAT total (IVA total)
  "grand_total_eur": number,        // total to pay (con IVA)
  "lines": [
    {
      "line_number": integer,        // 1-based
      "product_code": string,        // supplier SKU/ref if shown
      "product_name": string,        // product description as printed
      "quantity": number,
      "unit": string,                // "ud" | "kg" | "l" | "cj" | "bt" | free text as printed
      "unit_price_eur": number,      // price per unit (pre-VAT if the doc separates)
      "discount_pct": number,        // 0 if none
      "line_subtotal_eur": number,   // qty * unit_price after discount, before VAT
      "vat_rate": number,            // 4 | 10 | 21 (Spain) — the % as an integer
      "vat_amount_eur": number,
      "line_total_eur": number,      // with VAT
      "confidence": number           // 0..1
    }
  ],
  "raw_ocr_text": string,           // the full text you read off the doc, in reading order
  "extraction_confidence": {         // per-field 0..1, at minimum for the header fields
    "supplier_name": number,
    "invoice_number": number,
    "document_date": number,
    "grand_total_eur": number,
    "subtotal_eur": number,
    "vat_eur": number
  }
}

Classification rules:
- invoice = factura (has invoice number + VAT + total)
- albaran = albarán / nota de entrega / delivery note (lines but often no prices)
- eod = end-of-day POS report / Z / cierre de caja
- other = receipt without proper fields, statement, contract, business card

Numeric rules:
- Comma decimals in Spanish docs mean dot decimals in JSON: "12,34" -> 12.34
- If a line shows qty and total but no unit_price, compute unit_price = subtotal / qty
- Sum lines should reconcile with subtotal_eur ± 0.05; if they don't, still report what's printed
- VAT rate is the integer percentage (10 not 0.10)
- Never leave a required numeric as "" — use null

If the doc is clearly not an invoice or albarán, set lines: [] and extract whatever header you can.`;

type ExtractedLine = {
  line_number: number;
  product_code?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price_eur?: number | null;
  discount_pct?: number | null;
  line_subtotal_eur?: number | null;
  vat_rate?: number | null;
  vat_amount_eur?: number | null;
  line_total_eur?: number | null;
  confidence?: number | null;
};

type Extracted = {
  type: "invoice" | "albaran" | "eod" | "other";
  supplier_name?: string | null;
  supplier_vat_id?: string | null;
  invoice_number?: string | null;
  document_date?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
  payment_card_last4?: string | null;
  payment_iban?: string | null;
  currency?: string | null;
  subtotal_eur?: number | null;
  vat_eur?: number | null;
  grand_total_eur?: number | null;
  lines?: ExtractedLine[];
  raw_ocr_text?: string | null;
  extraction_confidence?: Record<string, number> | null;
};

async function extractWithSonnet(base64: string, mediaType: string): Promise<{ ok: true; data: Extracted } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY missing" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Extract this document and return the JSON described." },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `sonnet ${r.status}: ${t.slice(0, 200)}` };
  }
  const j = await r.json();
  const text: string = j?.content?.[0]?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "no JSON in reply" };
  try {
    const parsed = JSON.parse(match[0]) as Extracted;
    return { ok: true, data: parsed };
  } catch (e: any) {
    return { ok: false, error: "JSON parse: " + e?.message };
  }
}

function n(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}
function s(v: any): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function d(v: any): string | null {
  const t = s(v);
  if (!t) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    const entKey = serverEntity();
    const entCode = ENTITY_CODE[entKey] || "BM";
    const restaurantId = ENTITY_TO_RESTAURANT[entKey] || null;

    const form = await req.formData();
    const file = form.get("file");
    const requestedType = String(form.get("type") || "auto");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const mediaType = (file as any).type || "image/jpeg";
    const ext = (mediaType.split("/")[1] || "jpg");
    const ts = Date.now();

    // base64 encode for Anthropic
    const u8 = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = typeof Buffer !== "undefined" ? Buffer.from(u8).toString("base64") : btoa(bin);

    // 1) Extract with Sonnet
    const ext_res = await extractWithSonnet(b64, mediaType);
    const extracted: Extracted = ext_res.ok
      ? ext_res.data
      : { type: "other", extraction_confidence: null };
    const extractionError = ext_res.ok ? null : ext_res.error;

    // Final doc type — respect the button Boris pressed; only auto-classify
    // when the client explicitly asked for "auto".
    let type = requestedType;
    if (type === "auto" || !["invoice", "albaran", "eod", "other"].includes(type)) {
      type = extracted.type || "other";
    }

    // 2) Storage
    const storagePath = `${entCode}/${type}/${ts}.${ext}`;
    const up = await sb.storage
      .from("captures")
      .upload(storagePath, buf, { contentType: mediaType, upsert: false });
    if (up.error) {
      return NextResponse.json(
        { ok: false, error: "storage: " + up.error.message },
        { status: 500 }
      );
    }
    const signed = await sb.storage.from("captures").createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    const doc_url = signed.data?.signedUrl || null;

    // 3) invoice_inbox row (upsert on storage_path so re-extraction is safe)
    const arrivedAt =
      d(extracted.document_date)
        ? d(extracted.document_date) + "T00:00:00Z"
        : new Date().toISOString();
    const inboxRow: Record<string, any> = {
      entity_id: entCode,
      restaurant_id: restaurantId,
      source: "paper_photo",
      arrived_at: arrivedAt,
      doc_url,
      storage_path: storagePath,
      doc_type: type,
      supplier_name: s(extracted.supplier_name),
      supplier_vat_id: s(extracted.supplier_vat_id),
      invoice_number: s(extracted.invoice_number),
      document_date: d(extracted.document_date),
      due_date: d(extracted.due_date),
      payment_method: s(extracted.payment_method),
      payment_card_last4: s(extracted.payment_card_last4),
      payment_iban: s(extracted.payment_iban),
      currency: s(extracted.currency) || "EUR",
      subtotal_eur: n(extracted.subtotal_eur),
      vat_eur: n(extracted.vat_eur),
      grand_total_eur: n(extracted.grand_total_eur),
      amount_eur: n(extracted.grand_total_eur),
      extraction_confidence: extracted.extraction_confidence || null,
      raw_ocr_text: s(extracted.raw_ocr_text),
      extraction_model: "claude-sonnet-4-5-20250929",
      extraction_at: new Date().toISOString(),
      ocr_extracted: extracted as any,
      match_status: "needs_triage",
      notes: extractionError
        ? `captured via /capture — extraction failed: ${extractionError}`
        : `captured via /capture · sonnet-4.5 · ${(extracted.lines || []).length} lines`,
    };

    const { data: inboxData, error: inboxErr } = await sb
      .from("invoice_inbox")
      .upsert(inboxRow, { onConflict: "storage_path" })
      .select("id")
      .maybeSingle();
    if (inboxErr) {
      return NextResponse.json(
        { ok: false, error: "invoice_inbox: " + inboxErr.message, storagePath, extractionError },
        { status: 500 }
      );
    }
    const inboxId = inboxData?.id;

    // 4) purchase_lines — one row per line, idempotent
    let linesInserted = 0;
    const rawLines = Array.isArray(extracted.lines) ? extracted.lines : [];
    if (inboxId && rawLines.length > 0 && (type === "invoice" || type === "albaran")) {
      await sb.from("purchase_lines").delete().eq("invoice_inbox_id", inboxId);
      const rows = rawLines.map((ln, idx) => ({
        invoice_inbox_id: inboxId,
        entity_code: entCode,
        restaurant_id: restaurantId,
        doc_date: d(extracted.document_date),
        doc_ref: s(extracted.invoice_number),
        line_number: Number.isFinite(ln.line_number as any) ? ln.line_number : idx + 1,
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
        source: "capture_rich",
        imported_at: new Date().toISOString(),
      }));
      const { error: linesErr, count } = await sb
        .from("purchase_lines")
        .insert(rows, { count: "exact" });
      if (!linesErr) linesInserted = count || rows.length;
    }

    return NextResponse.json({
      ok: true,
      capture_id: inboxId,
      type,
      supplier_name: extracted.supplier_name || null,
      supplier_vat_id: extracted.supplier_vat_id || null,
      invoice_number: extracted.invoice_number || null,
      document_date: d(extracted.document_date),
      due_date: d(extracted.due_date),
      payment_method: extracted.payment_method || null,
      payment_card_last4: extracted.payment_card_last4 || null,
      currency: extracted.currency || "EUR",
      subtotal_eur: n(extracted.subtotal_eur),
      vat_eur: n(extracted.vat_eur),
      grand_total_eur: n(extracted.grand_total_eur),
      lines: rawLines,
      lines_stored: linesInserted,
      extraction_confidence: extracted.extraction_confidence || null,
      raw_ocr_text: extracted.raw_ocr_text || null,
      doc_url,
      storage_path: storagePath,
      extraction_error: extractionError,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
