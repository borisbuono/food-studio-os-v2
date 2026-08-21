import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/ask — the Chef FAB's endpoint since v2. Kept for the FAB to keep
// working identically, but internally now delegates to the Assistant Layer
// orchestrator (`generate({mode: "chat"})`). Response shape preserved so no
// client change is needed. The FAB expects: reply, intent, confidence, order,
// feedback, memory, did_action, user_turn_id.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const route = String(body?.route || "");
  const sessionId = String(body?.session_id || "") || null;
  const entityRaw = String(body?.entity_id || "bistro_mondo");
  // Map the FAB's entity_id (taller/bistro_mondo/holdings) to Assistant EntityCode.
  const entity: EntityCode = entityRaw === "bistro_mondo" ? "BM" : entityRaw === "holdings" ? "BBH" : "IFL";
  const pageContext = body?.page_context || null;
  const language = (body?.language === "es" ? "es" : "en") as "en" | "es";

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ configured: false, reply: "I've captured that — the assistant isn't switched on yet (needs ANTHROPIC_API_KEY).", intent: null, confidence: 0 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const [context, memory, config, history] = await Promise.all([
    orchestrator.getContext(entity, uid, pageContext),
    orchestrator.getMemory(entity, uid),
    orchestrator.getConfig(entity),
    orchestrator.getHistory(sessionId, uid),
  ]);

  // Language + route hints get prepended to the user prompt to preserve the
  // v1 behaviour (`[screen: ...]\n[lang: ...]\n<message>`).
  const prompt = (route ? "[screen: " + route + "]\n" : "") + (language ? "[lang: " + language + "]\n" : "") + message;

  const result = await orchestrator.generate({
    context, memory, config, history,
    prompt, mode: "chat", language,
  });

  let userTurnId: string | undefined;
  if (uid && result.ok) {
    const logged = await orchestrator.logInteraction({
      userId: uid, entity, route, sessionId, userPrompt: message, result, mode: "chat",
    });
    userTurnId = logged.user_turn_id;
  }

  // Flatten actions[] back into the legacy top-level shape the FAB reads.
  const order    = result.actions.find((a) => a.type === "order")?.data    ?? null;
  const feedback = result.actions.find((a) => a.type === "feedback")?.data ?? null;
  const memoryP  = result.actions.find((a) => a.type === "memory")?.data   ?? null;

  return Response.json({
    configured: true,
    reply: result.text,
    intent: result.intent,
    confidence: result.confidence,
    order,
    feedback,
    memory: memoryP,
    did_action: null,
    user_turn_id: userTurnId,
  });
}
