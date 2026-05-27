export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are reading a supplier delivery note or invoice from a photo. Extract the line items and return ONLY JSON (no prose, no code fences):
{"supplier": "...", "date": "YYYY-MM-DD or ''", "lines": [{"name": "product as written", "qty": number_or_null, "unit": "bottle|case|kg|l|u or ''", "unit_price": number_or_null, "total": number_or_null}]}.
unit_price is the price per single unit (per bottle if wine) BEFORE VAT where you can tell. If only a line total and qty are shown, compute unit_price = total / qty. Use dot decimals. Skip subtotal/VAT/total summary rows — only real product lines. If a number isn't legible, use null.`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const image = String(body?.image || "");
  const media_type = String(body?.media_type || "image/jpeg");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ ok: false, error: "Vision isn't switched on yet (ANTHROPIC_API_KEY)." });
  if (!image) return Response.json({ ok: false, error: "No image." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: "Read this delivery note / invoice and return the JSON." },
        ] }],
      }),
    });
    const data = await r.json();
    const txt: string = data?.content?.[0]?.text || data?.error?.message || "";
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    if (!parsed || !Array.isArray(parsed.lines)) return Response.json({ ok: false, error: "Couldn't read the invoice — try a flatter, well-lit photo." });
    return Response.json({ ok: true, invoice: parsed });
  } catch (e: any) {
    return Response.json({ ok: false, error: "Scan error: " + (e?.message || "unknown") });
  }
}
