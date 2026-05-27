export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are a sommelier reading a wine label from a photo. From the image, extract what you can and return ONLY a JSON object (no prose, no code fences) with these keys:
{"name": "...", "producer": "...", "region": "...", "grape": "...", "vintage": "...", "cuvee": "specific cuvée / bottling name if any", "classification": "quality tier exactly as printed — e.g. Grand Cru, Premier Cru, Gran Reserva, Reserva, single-vineyard name, or \"\"", "wine_style": "sparkling|white|orange|rose|red|sweet|fortified", "tasting_notes": "one short line", "pitch": "one warm line a waiter can say to sell it", "description": "2-3 sentences covering grape, area and producer"}.\nBE PRECISE about cuvee and classification: in wine a one-word tier difference (Grand Cru vs Premier Cru, Reserva vs Gran Reserva, a single-vineyard name) is a completely different, often far pricier wine — capture exactly what the label says, never round up or guess a tier.
Use the label's language for names; write tasting_notes, pitch and description in English. If a field isn't legible, infer conservatively from what is visible or leave it "". vintage is the year only.`;

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
        model: "claude-haiku-4-5-20251001", max_tokens: 700, system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: "Read this wine label and return the JSON." },
        ] }],
      }),
    });
    const data = await r.json();
    const txt: string = data?.content?.[0]?.text || data?.error?.message || "";
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    if (!parsed) return Response.json({ ok: false, error: "Couldn't read the label — try a clearer, straight-on photo." });
    return Response.json({ ok: true, wine: parsed });
  } catch (e: any) {
    return Response.json({ ok: false, error: "Scan error: " + (e?.message || "unknown") });
  }
}
