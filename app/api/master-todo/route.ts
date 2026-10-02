import { supabaseServer } from "@/lib/supabaseServer";
import { registerWrite, isRegisterKind, REGISTER_CLOSED_IN } from "@/lib/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-todo?entity=IFL&view=mine|impact|source&status=&assignee=
//   → list of master_todos, ranked by (status priority, impact_score desc)
//   (status=open → everything that is still a task: not completed/deferred/noted)
// POST /api/master-todo
//   Body: { entity_code, title, description?, priority?, impact_score?,
//           source?, assignee_user_id?, due_at?, related_atoms?, context? }
//   → { ok, todo }
// PATCH /api/master-todo?id=…
//   Body: partial update (status / impact / due / assignee / etc.)
//
// Guardrail: only 'pa_orchestrator' | 'user_added' | 'system_generated' |
// 'from_conversation' are allowed as source. External writes without the
// pa_orchestrator marker default to 'user_added'.

const ALLOWED_SOURCES = new Set(["pa_orchestrator","user_added","system_generated","from_conversation"]);

function todayISO() { return new Date().toISOString(); }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const view = url.searchParams.get("view") || "impact";
  const status = url.searchParams.get("status");
  const assignee = url.searchParams.get("assignee");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  let q = sb.from("master_todos").select("*").limit(200);
  if (entity && entity !== "all") q = q.eq("entity_code", entity);
  if (status === "open") q = q.not("status", "in", REGISTER_CLOSED_IN);
  else if (status) q = q.eq("status", status);
  if (view === "mine") {
    if (!uid) return Response.json({ ok: true, todos: [] });
    q = q.eq("assignee_user_id", uid);
  }
  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const todos = (data || []).slice().sort((a: any, b: any) => {
    // Open first, then by impact_score desc, then due date asc.
    const closed = new Set(["completed", "deferred", "noted"]);
    const openA = closed.has(a.status) ? 1 : 0;
    const openB = closed.has(b.status) ? 1 : 0;
    if (openA !== openB) return openA - openB;
    if (view === "source") return String(a.source).localeCompare(String(b.source));
    if ((b.impact_score || 0) !== (a.impact_score || 0)) return (b.impact_score || 0) - (a.impact_score || 0);
    const da = a.due_at ? Date.parse(a.due_at) : Infinity;
    const db = b.due_at ? Date.parse(b.due_at) : Infinity;
    return da - db;
  });

  // Optional assignee filter, applied post-sort.
  const filtered = assignee ? todos.filter((t: any) => t.assignee_user_id === assignee) : todos;
  return Response.json({ ok: true, todos: filtered });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const title = String(body?.title || "").trim();
  if (!title) return Response.json({ ok: false, error: "title required" }, { status: 400 });

  // Guardrail: refuse to write source=pa_orchestrator unless the caller is
  // the PA orchestrator (marker header). This keeps outside writes from
  // masquerading as PA-generated.
  let source = String(body?.source || "user_added");
  if (!ALLOWED_SOURCES.has(source)) source = "user_added";
  const marker = req.headers.get("x-pa-orchestrator");
  if (source === "pa_orchestrator" && marker !== process.env.PA_ORCHESTRATOR_MARKER && marker !== "true") {
    source = "user_added";
  }

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  // S1 (2026-10-02): ONE write path into the register. register_write()
  // derives entity_id from the code and RLS refuses entities the caller is
  // not a member of. kind defaults to 'commitment' (a todo); the extra
  // fields this legacy form carries are patched onto the row afterwards.
  const entity_code = String(body?.entity_code || "").trim();
  if (!entity_code) return Response.json({ ok: false, error: "entity_code required" }, { status: 400 });
  const kind = isRegisterKind(body?.kind) ? body.kind : "commitment";
  const w = await registerWrite(sb, { entity_code, kind, body: title, due: body?.due_at || null, source });
  if ("error" in w) return Response.json({ ok: false, error: w.error }, { status: w.status });
  const patch: any = {
    priority: clamp(body?.priority, 1, 5, 3),
    impact_score: clamp(body?.impact_score, 1, 5, 3),
  };
  if (body?.description) patch.description = String(body.description).slice(0, 5000);
  if (body?.assignee_user_id) patch.assignee_user_id = body.assignee_user_id;
  if (body?.related_atoms) patch.related_atoms = body.related_atoms;
  if (body?.context) patch.context = { ...(body.context || {}), via: "register_write" };
  const { data, error } = await sb.from("master_todos").update(patch).eq("id", w.id).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, todo: data });
}

export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  if (typeof body?.title === "string") patch.title = body.title.slice(0, 500);
  if (typeof body?.description === "string") patch.description = body.description.slice(0, 5000);
  if (typeof body?.status === "string") {
    patch.status = body.status;
    if (body.status === "completed") patch.completed_at = todayISO();
  }
  if (body?.priority != null) patch.priority = clamp(body.priority, 1, 5, 3);
  if (body?.impact_score != null) patch.impact_score = clamp(body.impact_score, 1, 5, 3);
  if (body?.due_at !== undefined) patch.due_at = body.due_at || null;
  if (body?.assignee_user_id !== undefined) patch.assignee_user_id = body.assignee_user_id || null;
  if (body?.related_atoms !== undefined) patch.related_atoms = body.related_atoms || {};
  if (body?.context !== undefined) patch.context = body.context || {};

  const sb = supabaseServer();
  const { data, error } = await sb.from("master_todos").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, todo: data });
}

function clamp(n: any, lo: number, hi: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
