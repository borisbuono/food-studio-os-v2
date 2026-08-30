/**
 * scripts/reprocess_captures.ts
 *
 * One-shot re-processor for the 6 orphan captures Boris took at
 * 2026-08-30 16:06–16:09 CET while signed out. Storage got the JPEGs
 * (bucket `captures` is anon-friendly) but the DB writes were rejected
 * by RLS (`invoice_inbox` and `purchase_lines` require `authenticated`),
 * so 6 photos have no matching rows.
 *
 * Usage (from repo root):
 *   npx tsx scripts/reprocess_captures.ts
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← bypasses RLS
 *   ANTHROPIC_API_KEY
 *
 * This is a one-shot. Once Boris has re-shot the docs the auth guard on
 * /capture (added same day) prevents this class of failure. Keep the
 * file around so we have a template for future orphan sweeps.
 */

import { createClient } from "@supabase/supabase-js";

// Load .env.local via Node's built-in --env-file flag:
//   node --env-file=.env.local --loader tsx scripts/reprocess_captures.ts
// or npx tsx --env-file=.env.local scripts/reprocess_captures.ts

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!SUPA_URL || !SUPA_SR) throw new Error("Missing SUPABASE_URL / SERVICE_ROLE_KEY in .env.local");
if (!ANTHROPIC) throw new Error("Missing ANTHROPIC_API_KEY in .env.local");

const sb = createClient(SUPA_URL, SUPA_SR, { auth: { persistSession: false } });

// The 6 orphans (Boris 2026-08-30 test).
const ORPHANS = [
  "BM/other/1788106156407.jpeg",
  "BM/invoice/1788106147224.jpeg",
  "BM/invoice/1788106118630.jpeg",
  "BM/invoice/1788106015432.jpeg",
  "BM/other/1788106001654.jpeg",
  "BM/other/1788105982888.jpeg",
];

// BM restaurant_id — matches ENTITY_TO_RESTAURANT.bistro_mondo
const BM_RESTAURANT_ID = "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
// Boris borisbuono@gmail auth uid, per task brief.
const BORIS_UID = "192d6268-1c1f-4a3f-8ba7-e15f0e2c4e02";

// The same Sonnet prompt used by /api/capture/rich. Duplicated (not
// imported) so this script has no coupling to the Next.js app.
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

async function extractWithSonnet(base64: string, mediaType: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: EXTRACTION_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Extract this document and return the JSON described." },
        ],
      }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false as const, error: `sonnet ${r.status}: ${t.slice(0, 400)}` };
  }
  const j = await r.json();
  const text: string = j?.content?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false as const, error: "no JSON in reply" };
  try {
    return { ok: true as const, data: JSON.parse(m[0]) };
  } catch (e: any) {
    return { ok: false as const, error: "JSON parse: " + e?.message };
  }
}

function n(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}
function s(v: any) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function d(v: any) {
  const t = s(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

async function processOne(storagePath: string) {
  console.log(`\n─── ${storagePath}`);
  // 1. Download the JPEG (service role bypasses any storage RLS)
  const dl = await sb.storage.from("captures").download(storagePath);
  if (dl.error || !dl.data) {
    console.log("  download failed:", dl.error?.message);
    return { storagePath, ok: false, error: "download: " + dl.error?.message };
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const b64 = buf.toString("base64");
  const mediaType = "image/jpeg";

  // 2. Sonnet OCR
  const ext = await extractWithSonnet(b64, mediaType);
  if (!ext.ok) {
    console.log("  OCR failed:", ext.error);
    return { storagePath, ok: false, error: ext.error };
  }
  const e = ext.data as any;

  // 3. Header row into invoice_inbox (upsert on storage_path)
  const type = ["invoice", "albaran", "eod", "other"].includes(e.type) ? e.type : "other";
  const arrivedAt = d(e.document_date) ? d(e.document_date) + "T00:00:00Z" : new Date().toISOString();
  const inboxRow = {
    entity_id: "BM",
    restaurant_id: BM_RESTAURANT_ID,
    source: "paper_photo",
    arrived_at: arrivedAt,
    doc_url: null as string | null,
    storage_path: storagePath,
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
  // Signed URL for convenience
  const signed = await sb.storage.from("captures").createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  inboxRow.doc_url = signed.data?.signedUrl || null;

  const up = await sb.from("invoice_inbox").upsert(inboxRow, { onConflict: "storage_path" }).select("id").maybeSingle();
  if (up.error) {
    console.log("  invoice_inbox upsert failed:", up.error.message);
    return { storagePath, ok: false, error: "inbox: " + up.error.message };
  }
  const inboxId = up.data?.id;

  // 4. purchase_lines (only for invoice/albaran)
  let linesInserted = 0;
  const rawLines = Array.isArray(e.lines) ? e.lines : [];
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
    if (ins.error) {
      console.log("  purchase_lines insert failed:", ins.error.message);
    } else {
      linesInserted = ins.count || rows.length;
    }
  }

  const conf = e.extraction_confidence || {};
  const avgConf = Object.values(conf).length
    ? (Number(Object.values(conf).reduce<number>((a, b) => a + Number(b || 0), 0)) / Object.values(conf).length).toFixed(2)
    : "—";
  console.log(`  type=${type} supplier="${e.supplier_name || "?"}" total=€${e.grand_total_eur ?? "?"} lines=${linesInserted}/${rawLines.length} conf=${avgConf}`);

  return {
    storagePath,
    ok: true,
    inboxId,
    type,
    supplier: e.supplier_name,
    total: e.grand_total_eur,
    lines: linesInserted,
    lineTotalPrinted: rawLines.length,
    conf,
  };
}

(async () => {
  console.log(`Reprocessing ${ORPHANS.length} orphan captures...`);
  const results = [];
  for (const path of ORPHANS) {
    results.push(await processOne(path));
  }
  console.log("\n════ SUMMARY ════");
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.storagePath} → ${r.type} · ${r.supplier || "?"} · €${r.total ?? "?"} · ${r.lines}L`);
    } else {
      console.log(`✗ ${r.storagePath} · ${r.error}`);
    }
  }
})();
