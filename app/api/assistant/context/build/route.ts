import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, resolveEntityScope } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/context/build
// { entity: <EntityCode | entities.id UUID>, page_context?: any }
// → { context: AssistantContext } | { ok: false, error }
//
// Multi-tenant scoping (2026-09-20) — accepts either the legacy 3-letter
// EntityCode or an entities.id UUID. Unknown ids get a firm 404-shaped
// refusal instead of falling through to a Boris-shaped default.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entityRaw = String(body?.entity || "").trim();
  const pageContext = body?.page_context ?? null;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const scope = await resolveEntityScope(entityRaw);
  if (!scope) return Response.json({ ok: false, error: "unknown entity: " + entityRaw }, { status: 404 });

  const route = (pageContext && (pageContext.route || pageContext.pathname)) || null;
  const context = await orchestrator.getContext(scope, uid, pageContext, route);
  return Response.json({ ok: true, context });
}
