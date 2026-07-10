import { supabaseServer } from "@/lib/supabaseServer";
import { extractFactsFromConversation } from "@/lib/assistant/memory/extractor";
import type { EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/memory/extract
// { session_id, entity? }
// The FAB pings this fire-and-forget on close / navigation-away. If the
// session has fewer than 2 real turns, or was extracted in the last 5
// minutes, the call short-circuits at zero cost.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body?.session_id || "").trim();
  const entity = (String(body?.entity || "IFL").toUpperCase() as EntityCode | string);
  if (!sessionId) return Response.json({ ok: false, error: "session_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const result = await extractFactsFromConversation({
    session_id: sessionId,
    user_id: uid,
    entity,
  });

  return Response.json({
    ok: result.ok,
    reason: result.reason || null,
    inserted: result.inserted,
    skipped_duplicate: result.skipped_duplicate,
    skipped_low_confidence: result.skipped_low_confidence,
    facts: result.facts,
    cost_eur: result.cost_eur,
    latency_ms: result.latency_ms,
    model: result.model,
  });
}
