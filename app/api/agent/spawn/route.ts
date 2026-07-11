import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agent/spawn
//   Body: { entity_code?, agent_type, objective, scope?, constraints?,
//           success_criteria?, deliverables?, related_todo_id? }
//   → { ok, charter }
//
// This creates a charter row BEFORE the agent runs. Status starts as
// 'ready'. A future agent runner (Sprint N) will flip status to 'running',
// fill output_summary, and mark 'completed'.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const objective = String(body?.objective || "").trim();
  if (!objective) return Response.json({ ok: false, error: "objective required" }, { status: 400 });

  const agentType = String(body?.agent_type || "research");
  const allowed = new Set(["research","build","write","pa","other"]);
  const agent_type = allowed.has(agentType) ? agentType : "research";

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const row: any = {
    entity_code: body?.entity_code || null,
    agent_type,
    objective: objective.slice(0, 5000),
    scope: body?.scope ? String(body.scope).slice(0, 5000) : null,
    constraints: body?.constraints ? String(body.constraints).slice(0, 5000) : null,
    success_criteria: body?.success_criteria ? String(body.success_criteria).slice(0, 5000) : null,
    deliverables: Array.isArray(body?.deliverables) ? body.deliverables : [],
    related_todo_id: body?.related_todo_id || null,
    status: "ready",
    spawned_by_user_id: uid,
  };

  const { data, error } = await sb.from("agent_charters").insert(row).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, charter: data });
}

// PATCH /api/agent/spawn?id=…
//   Body: partial (status / output_summary / started_at / completed_at)
export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  if (typeof body?.status === "string") {
    patch.status = body.status;
    if (body.status === "running" && !body.started_at) patch.started_at = new Date().toISOString();
    if (body.status === "completed" || body.status === "abandoned" || body.status === "failed") {
      patch.completed_at = new Date().toISOString();
    }
  }
  if (typeof body?.output_summary === "string") patch.output_summary = body.output_summary.slice(0, 20000);
  if (Array.isArray(body?.deliverables)) patch.deliverables = body.deliverables;

  const sb = supabaseServer();
  const { data, error } = await sb.from("agent_charters").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, charter: data });
}

// GET /api/agent/spawn?entity=IFL&agent_type=research&status=…
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sb = supabaseServer();
  let q = sb.from("agent_charters").select("*").order("created_at", { ascending: false }).limit(100);
  const entity = url.searchParams.get("entity");
  const agent_type = url.searchParams.get("agent_type");
  const status = url.searchParams.get("status");
  if (entity && entity !== "all") q = q.eq("entity_code", entity);
  if (agent_type && agent_type !== "all") q = q.eq("agent_type", agent_type);
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, charters: data || [] });
}
