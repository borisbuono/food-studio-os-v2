import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, resolveEntityScope, codeForEntityId } from "@/lib/assistant/orchestrator";
import { E_BM } from "@/lib/entities";
import { getMyMembershipContext } from "@/lib/memberships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/ask — the Chef FAB's endpoint since v2. Kept for the FAB to keep
// working identically, but internally now delegates to the Assistant Layer
// orchestrator (`generate({mode: "chat"})`). Response shape preserved so no
// client change is needed. The FAB expects: reply, intent, confidence, order,
// feedback, memory, did_action, user_turn_id.
//
// Multi-tenant scoping (2026-09-20): the FAB posts entity_id as a UUID from
// the fs_entity cookie. We resolve the entities row, verify the caller has
// active membership in that entity, and refuse the turn if not. Pre-fix, a
// bogus / unknown entity_id was silently coerced to EntityCode "IFL" (see
// TO_BORIS_chef_context_audit_2026-09-20.md) — every non-Boris venue read
// Taller's data. That coercion is gone.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const route = String(body?.route || "");
  const sessionId = String(body?.session_id || "") || null;
  const entityRaw = String(body?.entity_id || E_BM);
  const pageContext = body?.page_context || null;
  const language = (body?.language === "es" ? "es" : "en") as "en" | "es";

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ configured: false, reply: "I've captured that — the assistant isn't switched on yet (needs ANTHROPIC_API_KEY).", intent: null, confidence: 0 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  // Resolve the entity scope from the UUID (or legacy EntityCode). Unknown
  // ids fall through to null — refuse the turn rather than leak.
  const scope = await resolveEntityScope(entityRaw);
  if (!scope) {
    return Response.json({
      configured: true,
      reply: "I can't find that venue in the OS. Sign in again or pick a venue from the switcher.",
      intent: null, confidence: 0, order: null, feedback: null, memory: null, did_action: null,
    });
  }

  // Defence in depth: the FAB reads the fs_entity cookie which the user can
  // tamper with. Verify the caller is actually a member of this entity.
  // Boris hits this path constantly with membership across BM/Taller/BBH —
  // it's a cheap join. Non-members get a firm refusal instead of a silent
  // read of someone else's context.
  if (uid) {
    const mem = await getMyMembershipContext();
    const memberOf = new Set((mem.memberships || []).map((m) => m.entity_id));
    if (!memberOf.has(scope.entity.id)) {
      return Response.json({
        configured: true,
        reply: "You're not a member of " + (scope.entity.name || "this venue") + ". Pick one of your own venues from the switcher.",
        intent: null, confidence: 0, order: null, feedback: null, memory: null, did_action: null,
      });
    }
  }

  const [context, memory, config, history] = await Promise.all([
    orchestrator.getContext(scope, uid, pageContext, route),
    orchestrator.getMemory(scope, uid),
    orchestrator.getConfig(scope),
    orchestrator.getHistory(sessionId, uid),
  ]);
  // Legacy EntityCode value for the FAB logs — falls back to the UUID for
  // non-pinned tenants.
  const entity = codeForEntityId(scope.entity.id) || scope.entity.id;

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
