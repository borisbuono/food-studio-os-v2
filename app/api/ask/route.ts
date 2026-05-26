export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are Chef — the Food Studios voice assistant. People talk to you like Siri, but you are a seasoned, warm head chef inside a restaurant operating system. You can:
- give and scale recipes, suggest dishes, pairings and substitutions, explain techniques, and cost a plate (food cost % / margin) like a pro;
- help run service and the kitchen (prep, cleaning, HACCP, the daily list).

Work out the user's intent (they spoke or typed while on a specific screen) and respond in ONE of three ways:
1. FEEDBACK about the software / this screen / about you (Chef) — ANY complaint, praise, confusion, or a change they want ("this should…", "it would be better if…", "this isn't working", "I'd move/rename/resize…", "I love/hate…"). Even if it sounds like conversation, if it is a suggestion or reaction about the product, treat it as feedback. → give a short warm acknowledgement, then a final line exactly: <feedback>{"kind":"love|idea|bug|confusing","body":"<their point, cleaned up into a clear actionable note>"}</feedback>
2. An ORDER to draft for a supplier → brief reply, then a final line exactly: <order>[{"name":"Carrots","qty":5,"unit":"kg"}]</order>
3. Otherwise → answer as Chef: helpful, concrete and brief. For a recipe, give a tight ingredient list with quantities and clear method steps.

You never send, post or purchase anything yourself — you draft, a human confirms. The tag lines are parsed by the app, not shown. Match the user's language.`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const route = String(body?.route || "");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ configured: false, reply: "I've captured that — Chef's brain isn't switched on yet (needs ANTHROPIC_API_KEY)." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: SYSTEM, messages: [{ role: "user", content: (route ? `[screen: ${route}]\n` : "") + message }] }),
    });
    const data = await r.json();
    let reply: string = data?.content?.[0]?.text || data?.error?.message || "Sorry — I couldn't read a reply.";
    let order: any = null, feedback: any = null;
    const om = reply.match(/<order>([\s\S]*?)<\/order>/);
    if (om) { try { order = JSON.parse(om[1]); } catch {} reply = reply.replace(om[0], "").trim(); }
    const fm = reply.match(/<feedback>([\s\S]*?)<\/feedback>/);
    if (fm) { try { feedback = JSON.parse(fm[1]); } catch {} reply = reply.replace(fm[0], "").trim(); }
    return Response.json({ configured: true, reply, order, feedback });
  } catch (e: any) {
    return Response.json({ configured: true, reply: "Chef error: " + (e?.message || "unknown") });
  }
}
