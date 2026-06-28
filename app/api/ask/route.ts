import { supabaseServer } from "@/lib/supabaseServer";
import { loadChefContext, writeTurn } from "@/lib/chef/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_BASE = `You are Chef — the Food Studios voice assistant. People talk to you like Siri, but you are a seasoned, warm head chef inside a restaurant operating system. You can:
- give and scale recipes, suggest dishes, pairings and substitutions, explain techniques, and cost a plate (food cost % / margin) like a pro;
- help run service and the kitchen (prep, cleaning, HACCP, the daily list);
- triage software feedback and draft purchase orders.

For every user turn, FIRST decide the intent and your confidence (0..1). Intents:
  ask        — recipe / cooking question / explanation / what-is / how-to / general help
  order      — drafting items to buy for a supplier
  feedback   — any reaction about the OS itself / a screen / a feature / a workflow / a bug
  capture    — the user is describing taking a photo (rare via voice; usually the long-press gesture handles this)
  memory     — the user is asking you to REMEMBER something durable ("remember that…", "from now on…", "always…")

Always reply with a short conversational answer THEN a final structured tag block on its own line, exactly:
<chef>{"intent":"ask|order|feedback|capture|memory","confidence":0.0-1.0,"order":[{"name":"...","qty":1,"unit":"kg"}]|null,"feedback":{"kind":"love|idea|bug|confusing","body":"..."}|null,"memory":{"fact":"...","scope":"global|entity:IFL|topic:finance"}|null,"did_action":null}</chef>

Rules:
- confidence ≥ 0.85 means you are certain. < 0.75 means you are unsure and the UI will ask the user to confirm.
- 'order' field non-null ONLY when intent is 'order'.
- 'feedback' field non-null ONLY when intent is 'feedback'.
- 'memory' field non-null ONLY when intent is 'memory'.
- You never send, post or purchase anything yourself — you draft, a human confirms.
- Match the user's language (English or Spanish).
- Use the conversation history + memory below to be consistent across turns. If you see something in memory that contradicts the user, ask before acting.`;

function buildSystem(ctx: { memory: { fact: string; scope?: string }[]; fewshot: { text: string; intent: string }[] }, pageContext: any) {
  const memBlock = ctx.memory.length ? `\n\nMemory (facts you should treat as true unless the user updates them):\n${ctx.memory.map((m, i) => `${i + 1}. ${m.fact}${m.scope && m.scope !== "global" ? ` [${m.scope}]` : ""}`).join("\n")}` : "";
  const fsBlock = ctx.fewshot.length ? `\n\nClassifier few-shot from this user's confirmed turns:\n${ctx.fewshot.map((p) => `"${p.text}" → ${p.intent}`).join("\n")}` : "";
  const pcBlock = pageContext ? `\n\nCurrent page context (structured): ${JSON.stringify(pageContext).slice(0, 2000)}` : "";
  return SYSTEM_BASE + memBlock + fsBlock + pcBlock;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const route = String(body?.route || "");
  const sessionId = String(body?.session_id || "") || null;
  const entityId = String(body?.entity_id || "") || null;
  const pageContext = body?.page_context || null;
  const language = String(body?.language || "en") || "en";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ configured: false, reply: "I've captured that — Chef's brain isn't switched on yet (needs ANTHROPIC_API_KEY).", intent: null, confidence: 0 });

  const ctx = await loadChefContext({ sessionId: sessionId || undefined });
  const system = buildSystem(ctx, pageContext);

  // Write the user turn first (best-effort; ignore if anon)
  let userTurnId: string | undefined;
  if (ctx.uid) userTurnId = await writeTurn(ctx.uid, { entity_id: entityId, route, session_id: sessionId, turn_role: "user", text: message });

  try {
    const messages = [
      ...ctx.history.map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.text })),
      { role: "user", content: (route ? `[screen: ${route}]\n` : "") + (language ? `[lang: ${language}]\n` : "") + message },
    ];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, system, messages }),
    });
    const data = await r.json();
    let reply: string = data?.content?.[0]?.text || data?.error?.message || "Sorry — I couldn't read a reply.";

    // Parse the <chef>{...}</chef> tail
    let parsed: any = null;
    const m = reply.match(/<chef>([\s\S]*?)<\/chef>/);
    if (m) { try { parsed = JSON.parse(m[1]); } catch {} reply = reply.replace(m[0], "").trim(); }

    // Back-compat for legacy <order>/<feedback> tags (old prompts may still emit them)
    let order: any = parsed?.order || null;
    let feedback: any = parsed?.feedback || null;
    if (!order) { const om = reply.match(/<order>([\s\S]*?)<\/order>/); if (om) { try { order = JSON.parse(om[1]); } catch {} reply = reply.replace(om[0], "").trim(); } }
    if (!feedback) { const fm = reply.match(/<feedback>([\s\S]*?)<\/feedback>/); if (fm) { try { feedback = JSON.parse(fm[1]); } catch {} reply = reply.replace(fm[0], "").trim(); } }

    const intent = parsed?.intent || (order ? "order" : feedback ? "feedback" : "ask");
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : (order || feedback ? 0.7 : 0.6);
    const memoryProposal = parsed?.memory || null;

    if (ctx.uid) {
      await writeTurn(ctx.uid, { entity_id: entityId, route, session_id: sessionId, turn_role: "assistant", text: reply, intent, confidence });
    }

    return Response.json({ configured: true, reply, intent, confidence, order, feedback, memory: memoryProposal, did_action: null, user_turn_id: userTurnId });
  } catch (e: any) {
    return Response.json({ configured: true, reply: "Chef error: " + (e?.message || "unknown"), intent: null, confidence: 0 });
  }
}
