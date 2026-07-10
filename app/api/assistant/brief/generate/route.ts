import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIEF_PROMPT = `Write today's morning brief for the operator. Read the OS state block above carefully and only reference what's actually there — do not invent numbers, covers, invoices, or tasks. 4 to 6 short editorial paragraphs, no lists. Cover the shape of the day, what matters in the kitchen, what matters in the office, and one small nudge to lift the day.`;

// POST /api/assistant/brief/generate
// { entity, date?, force? }
// → { ok, brief: { entity_code, user_id, date, body, created_at } }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = (String(body?.entity || "IFL").toUpperCase() as EntityCode);
  const force = !!body?.force;
  const date = String(body?.date || new Date().toISOString().slice(0, 10));

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  // If a brief already exists for today + not forcing, return it.
  if (!force) {
    const { data: existing } = await sb.from("assistant_briefs")
      .select("*").eq("entity_code", entity).eq("user_id", uid).eq("date", date).maybeSingle();
    if (existing) return Response.json({ ok: true, brief: existing, cached: true });
  }

  const [context, memory, config] = await Promise.all([
    orchestrator.getContext(entity, uid, null),
    orchestrator.getMemory(entity, uid),
    orchestrator.getConfig(entity),
  ]);

  const result = await orchestrator.generate({
    context, memory, config,
    prompt: BRIEF_PROMPT,
    mode: "brief",
  });

  if (!result.ok) return Response.json({ ok: false, error: result.text }, { status: 500 });

  // Upsert.
  const { data: brief, error } = await sb.from("assistant_briefs")
    .upsert({ entity_code: entity, user_id: uid, date, body: result.text }, { onConflict: "entity_code,user_id,date" })
    .select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Meter the generation — Sprint 6 columns.
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_type: "brief_generate",
    action_kind: "brief",
    entity_code: entity,
    target_table: "assistant_briefs",
    target_id: brief?.id || null,
    cost_eur: result.cost_eur,
    latency_ms: result.latency_ms,
    model: result.model,
    input_tokens:  result.input_tokens,
    output_tokens: result.output_tokens,
    payload: { entity, date, mode: "brief", model: result.model, latency_ms: result.latency_ms, cost_usd: result.cost_usd, cost_eur: result.cost_eur },
    reversible: false,
  });

  return Response.json({ ok: true, brief, cached: false });
}
