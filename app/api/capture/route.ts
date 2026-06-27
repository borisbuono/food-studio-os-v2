import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";

export const runtime = "nodejs";

const ENTITY_CODE: Record<string, string> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };

type Detected = { type: "invoice" | "albaran" | "eod" | "other"; supplier_name?: string | null; total_eur?: number | null; vat_eur?: number | null; document_date?: string | null; confidence?: number; reasoning?: string };

async function classifyWithClaude(base64: string, mediaType: string): Promise<Detected | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text:
            "You are filing a paper document for a Spanish restaurant. Classify the document and extract key fields.\n\n" +
            "Reply ONLY with strict JSON, no prose, this shape:\n" +
            '{"type":"invoice|albaran|eod|other","supplier_name":"...","total_eur":12.34,"vat_eur":1.23,"document_date":"YYYY-MM-DD","confidence":0.95,"reasoning":"one phrase"}\n\n' +
            "Rules:\n" +
            "- invoice = factura (has price + VAT/IVA + invoice number + 'Factura'/'Factura nº')\n" +
            "- albaran = albarán / delivery note / nota de entrega / remito (line items, often no price or marked 'sin valor')\n" +
            "- eod = end-of-day report from POS / Z report / cierre de caja / arqueo diario (single totals, day timestamp, terminal id)\n" +
            "- other = anything else (receipt without proper invoice fields, statement, contract, etc.)\n" +
            "- Use null for any field you can't read confidently. Never invent numbers."
          },
        ],
      }],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const text = j.content?.[0]?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Detected; } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    const ent = ENTITY_CODE[serverEntity()] || "IFL";
    const form = await req.formData();
    const file = form.get("file");
    let type = String(form.get("type") || "auto");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });

    const buf = await file.arrayBuffer();
    const mediaType = (file as any).type || "image/jpeg";
    const ext = mediaType.split("/")[1] || "jpg";
    const ts = Date.now();

    // 1) Auto-detect if requested or not provided
    let detected: Detected | null = null;
    if (type === "auto" || !["invoice","albaran","eod","other"].includes(type)) {
      // base64 from ArrayBuffer (avoid Buffer for edge compat)
      const u8 = new Uint8Array(buf);
      let bin = ""; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      const b64 = typeof Buffer !== "undefined" ? Buffer.from(u8).toString("base64") : btoa(bin);
      detected = await classifyWithClaude(b64, mediaType);
      type = detected?.type || "other";
    }

    // 2) Upload to storage using the final type as the folder
    const path = `${ent}/${type}/${ts}.${ext}`;
    const up = await sb.storage.from("captures").upload(path, buf, { contentType: mediaType });
    if (up.error) return NextResponse.json({ ok: false, error: "storage: " + up.error.message }, { status: 500 });
    const signed = await sb.storage.from("captures").createSignedUrl(path, 60 * 60 * 24 * 30);
    const doc_url = signed.data?.signedUrl || null;

    // 3) Insert the right row, pre-filled if vision returned useful fields
    if (type === "invoice" || type === "other") {
      const { data } = await sb.from("invoice_inbox").insert({
        entity_id: ent,
        source: "paper_photo",
        arrived_at: detected?.document_date ? detected.document_date + "T00:00:00Z" : new Date().toISOString(),
        doc_url,
        supplier_name: detected?.supplier_name || null,
        amount_eur: detected?.total_eur ?? null,
        vat_eur: detected?.vat_eur ?? null,
        match_status: "needs_triage",
        notes: type === "other"
          ? `captured via /capture — other${detected?.reasoning ? " · " + detected.reasoning : ""}`
          : `captured via /capture${detected ? ` · ${detected.confidence ?? "?"} conf · ${detected.reasoning || ""}` : ""}`,
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, detected, id: data?.id, where: "invoice_inbox", next: "/administrate/finance/scans" });
    }
    if (type === "albaran") {
      const { data } = await sb.from("albarans").insert({
        entity_id: ent,
        received_at: detected?.document_date ? detected.document_date + "T00:00:00Z" : new Date().toISOString(),
        photo_url: doc_url,
        match_status: "drop_in",
        notes: `captured via /capture — albarán${detected?.supplier_name ? " · " + detected.supplier_name : ""}${detected?.reasoning ? " · " + detected.reasoning : ""}`,
        ocr_extracted: detected ? (detected as any) : null,
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, detected, id: data?.id, where: "albarans", next: "/execute/receiving" });
    }
    if (type === "eod") {
      const { data } = await sb.from("invoice_inbox").insert({
        entity_id: ent, source: "paper_photo",
        arrived_at: detected?.document_date ? detected.document_date + "T00:00:00Z" : new Date().toISOString(),
        doc_url, match_status: "needs_triage",
        notes: `EOD photo — transcribe at /administrate/finance/eod/new${detected?.total_eur ? ` · total ~€${detected.total_eur}` : ""}`,
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, detected, id: data?.id, where: "EOD intake", next: "/administrate/finance/eod/new" });
    }
    return NextResponse.json({ ok: false, error: "unknown type" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
