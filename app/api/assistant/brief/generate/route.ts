import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/assistant/orchestrator";
import { generateBrief } from "@/lib/assistant/brief/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/brief/generate
// { entity, date?, force? }
// → { ok, brief, cached }
//
// The heavy lifting lives in lib/assistant/brief/generator — the route is
// a thin auth + response shim. Polish #2 rebuilt the generator to weave
// email / WhatsApp / payments / reviews / memory into the brief, so this
// route now returns a richer object (headline + signals + body).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = (String(body?.entity || "IFL").toUpperCase() as EntityCode);
  const force = !!body?.force;
  const date = body?.date ? String(body.date) : undefined;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const result = await generateBrief({ entity, user_id: uid, date, force });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error || "brief failed" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    cached: result.cached,
    brief: {
      id: result.brief_id,
      entity_code: result.entity,
      user_id: uid,
      date: result.date,
      headline: result.headline,
      body: result.body,
      signals: result.signals,
    },
  });
}
