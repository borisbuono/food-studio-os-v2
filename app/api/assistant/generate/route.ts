import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode, AssistantMode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/generate
// { entity, prompt, mode: "chat"|"brief"|"draft", route?, session_id?, page_context?, language? }
// → { ok, text, intent, confidence, actions, cost_usd, latency_ms }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = (String(body?.entity || "IFL").toUpperCase() as EntityCode);
  const prompt = String(body?.prompt || "").slice(0, 4000);
  const mode = (String(body?.mode || "chat") as AssistantMode);
  const route = String(body?.route || "") || null;
  const sessionId = String(body?.session_id || "") || null;
  const pageContext = body?.page_context ?? null;
  const language = (body?.language === "es" ? "es" : "en") as "en" | "es";

  if (!prompt) return Response.json({ ok: false, error: "prompt required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const [context, memory, config, history] = await Promise.all([
    orchestrator.getContext(entity, uid, pageContext),
    orchestrator.getMemory(entity, uid),
    orchestrator.getConfig(entity),
    mode === "chat" ? orchestrator.getHistory(sessionId, uid) : Promise.resolve([]),
  ]);

  const result = await orchestrator.generate({
    context, memory, config, history,
    prompt, mode, language,
  });

  let userTurnId: string | undefined;
  if (uid && result.ok) {
    const logged = await orchestrator.logInteraction({
      userId: uid, entity, route, sessionId, userPrompt: prompt, result, mode,
    });
    userTurnId = logged.user_turn_id;
  }

  return Response.json({
    ok: result.ok,
    text: result.text,
    intent: result.intent,
    confidence: result.confidence,
    actions: result.actions,
    cost_usd: result.cost_usd,
    latency_ms: result.latency_ms,
    model: result.model,
    user_turn_id: userTurnId || null,
  });
}
