// Capture funnel — vision extraction. Server-only.
//
// PDFs go to Claude as a `document` block, so image-only scans (the whole
// 73-doc test corpus has no text layer) are read page by page by the model —
// no server-side rasterising, and every page is seen, not just page 1.
// Images go as an `image` block, as before.

import type { Line } from "@/lib/capture/pure";

export const EXTRACTION_MODEL = "claude-sonnet-4-5-20250929";

export type Extracted = {
  model_type?: string | null;
  doc_word?: string | null;                 // the word printed as the document title
  supplier_name?: string | null;
  supplier_vat_id?: string | null;
  addressee_name?: string | null;           // the customer block: who the doc is addressed TO
  addressee_vat_id?: string | null;
  addressee_department?: string | null;     // "Dept Bistro Mondo" etc. — NOT the entity
  doc_number?: string | null;
  document_date?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
  payment_card_last4?: string | null;
  payment_iban?: string | null;
  subtotal_eur?: number | null;
  vat_eur?: number | null;
  grand_total_eur?: number | null;
  vat_bands?: { regime?: string; rate: number; base: number; cuota: number; label?: string; country?: string | null }[];
  customer_details_present?: boolean | null;   // OUR name + NIF printed as the customer
  simplified_invoice_number?: string | null;   // ticket / factura simplificada number
  referenced_ticket_numbers?: string[];        // a factura that cites the ticket(s) it replaces
  supplier_contact?: { email?: string | null; phone?: string | null; address?: string | null; website?: string | null } | null;
  payment_card_scheme?: string | null;         // "SOLRED", "VISA" …
  referenced_doc_numbers?: string[];        // albarán numbers an invoice lists
  handwritten_changes?: boolean;
  page_label?: string | null;               // "1 de 2" as printed
  pages_seen?: number | null;
  lines?: Line[];
  raw_ocr_text?: string | null;
  confidence?: number | null;               // overall 0..1
  extraction_confidence?: Record<string, number> | null;
};

const PROMPT = `You are digitising a Spanish supplier document for a restaurant group. It may be several pages.
Reply ONLY with strict JSON, no prose, no code fences. Use null when you cannot read a value confidently. Never invent numbers.

{
  "model_type": "invoice" | "albaran" | "ticket" | "quote" | "statement" | "eod" | "other",
  "doc_word": string,                 // the title word exactly as printed: "FACTURA", "ALBARÁN", "NOTA DE ENTREGA", "FACTURA SIMPLIFICADA", "PRESUPUESTO"...
  "supplier_name": string,            // the ISSUER (who sells)
  "supplier_vat_id": string,          // issuer CIF/NIF
  "addressee_name": string,           // the CUSTOMER block (who the document is addressed to) — legal company name as printed
  "addressee_vat_id": string,         // customer CIF/NIF as printed in the customer block
  "addressee_department": string,     // any department / delivery-point line under the customer ("Dept Bistro Mondo", "Taller de Tapas")
  "doc_number": string,               // number as printed, keep spaces and slashes
  "document_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD" | null,
  "payment_method": "cash" | "card" | "transfer" | "sepa" | "other" | null,
  "payment_card_last4": string | null,
  "payment_iban": string | null,
  "subtotal_eur": number,             // total base imponible
  "vat_eur": number,                  // total cuota IVA
  "grand_total_eur": number,          // total a pagar
  "vat_bands": [ { "regime": "iva", "rate": 10, "base": 61.75, "cuota": 6.17, "label": "IVA 10%" } ],
      // ONE entry per tax line in the tax summary. Multi-rate documents are normal (food 10, drinks/non-food 21, some 4).
      // regime: "iva" | "re" (recargo de equivalencia) | "intra_goods" / "intra_services" (EU supplier, "inversión del sujeto pasivo" / "reverse charge" / "Steuerschuldnerschaft", 0 cuota printed)
      //   | "isp" (Spanish inversión del sujeto pasivo) | "import" | "exempt" ("exento art. 20") | "not_subject" ("no sujeto")
      //   | "igic" (Canarias) | "ipsi" (Ceuta/Melilla) | "foreign_vat" (MwSt, TVA, IVA of another country — add "country": "DE")
      //   | "retention" (IRPF withheld, e.g. -15 %: rate 15, base = the base it applies to, cuota = amount withheld as a positive number)
      // label = the tax line exactly as printed.
  "customer_details_present": boolean,  // true ONLY if the document prints the CUSTOMER's company name AND NIF/CIF. A till ticket that shows IVA but no customer NIF is false.
  "simplified_invoice_number": string,  // for a ticket / factura simplificada: its number as printed (e.g. "4253-025-934413")
  "referenced_ticket_numbers": [string],// on a full factura: any "Factura simplificada nº / Ticket nº / Nº de ticket" it cites
  "supplier_contact": { "email": string, "phone": string, "address": string, "website": string },  // the ISSUER's, as printed
  "payment_card_scheme": string,        // card scheme or fuel card printed ("SOLRED", "VISA", "MASTERCARD"), null if none
  "referenced_doc_numbers": [string], // albarán / delivery numbers the document lists (invoices that consolidate deliveries)
  "handwritten_changes": boolean,     // true if quantities/prices are struck out or corrected by hand
  "page_label": string | null,        // "Página 1 de 2" etc. as printed
  "pages_seen": integer,              // how many pages you were given
  "lines": [ { "line_number": 1, "product_code": string, "product_name": string, "quantity": number, "unit": string,
               "unit_price_eur": number, "discount_pct": number, "line_subtotal_eur": number, "vat_rate": number,
               "vat_amount_eur": number, "line_total_eur": number, "confidence": number } ],
  "raw_ocr_text": string,
  "confidence": number,               // your overall confidence 0..1
  "extraction_confidence": { "supplier_name": n, "addressee_vat_id": n, "doc_number": n, "document_date": n, "grand_total_eur": n, "vat_bands": n }
}

Rules:
- A till ticket / "factura simplificada" is "ticket" even when it breaks out IVA; what makes a factura is the customer's fiscal details.
- Classify by the PRINTED TITLE WORD and the document series, not by whether prices appear. Albaranes in this business routinely carry prices AND IVA; they are still albaranes.
- The addressee is the customer block. A department or delivery line is NOT the customer company.
- Lines are products only. Do not emit totals, "base imponible", "IVA", "suma" or tax summary rows as lines.
- line_subtotal_eur = quantity × unit_price × (1 − discount/100), before IVA. If a product line prints only qty and amount, compute unit_price = amount / qty.
- Spanish decimals: "1.234,56" → 1234.56. VAT rate is the integer percent (10, not 0.10).
- If quantities or prices are corrected by hand, report the corrected (handwritten) values in lines and set handwritten_changes true.`;

export async function extractDocument(buf: ArrayBuffer, mediaType: string): Promise<{ ok: true; data: Extracted } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY missing" };
  const b64 = Buffer.from(new Uint8Array(buf)).toString("base64");
  const isPdf = mediaType === "application/pdf";
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        max_tokens: 12000,
        system: PROMPT,
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract this document and return the JSON described." }] }],
      }),
    });
    if (!r.ok) {
      lastErr = `anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`;
      if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 1500)); continue; }
      return { ok: false, error: lastErr };
    }
    const j = await r.json();
    const text: string = (j?.content || []).map((c: any) => c?.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { lastErr = "no JSON in reply"; continue; }
    try { return { ok: true, data: JSON.parse(m[0]) as Extracted }; }
    catch (e: any) { lastErr = "JSON parse: " + e?.message; }
  }
  return { ok: false, error: lastErr || "extraction failed" };
}
