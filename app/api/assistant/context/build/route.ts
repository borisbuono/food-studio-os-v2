import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/context/build
// { entity: "IFL" | "BM" | "BBH", page_context?: any }
// → { context: AssistantContext }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = (String(body?.entity || "IFL").toUpperCase() as EntityCode);
  const pageContext = body?.page_context ?? null;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const context = await orchestrator.getContext(entity, uid, pageContext);
  return Response.json({ ok: true, context });
}
