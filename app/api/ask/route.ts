export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = "You are the Food Studios assistant inside a restaurant operating system used by chefs, front-of-house and owners. Be concise, warm and practical. You can help draft supplier orders, explain food cost and margin, draft prep notes or tasks, and answer operational questions. You never send, post or purchase anything yourself — you produce a draft and a human confirms. Keep replies short (a few sentences) unless asked for detail. When the user asks to place or draft an order, finish your reply with one line exactly: <order>[{\"name\":\"Oranges\",\"qty\":5,\"unit\":\"kg\"}]</order> listing the items as JSON (this line is parsed by the app, not shown to the user).";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ configured: false, reply: "I've captured that. The assistant brain isn't switched on yet — add an ANTHROPIC_API_KEY in the project's environment and I'll start answering for real (and drafting orders, costs and tasks)." });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: message }] }),
    });
    const data = await r.json();
    let reply: string = data?.content?.[0]?.text || data?.error?.message || "Sorry — I couldn't read a reply.";
    let order: any = null;
    const m = typeof reply === "string" ? reply.match(/<order>([\s\S]*?)<\/order>/) : null;
    if (m) { try { order = JSON.parse(m[1]); } catch {} reply = reply.replace(m[0], "").trim(); }
    return Response.json({ configured: true, reply, order });
  } catch (e: any) {
    return Response.json({ configured: true, reply: "Assistant error: " + (e?.message || "unknown") });
  }
}

// redeploy: pick up ANTHROPIC_API_KEY (production)
