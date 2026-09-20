import { supabaseServer } from "@/lib/supabaseServer";
import { CANDIDATE_STATUSES, MANAGER_ONLY_STATUS_TARGETS, CandidateStatus } from "@/lib/hiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/hiring/candidates/[id]/status
// Body: { status, reason? }
// Advances state, appends to status_history, drops a candidate_touch.
// hired/offer require a manager on the entity.

type Body = { status?: string; reason?: string };

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Body;
  const target = String(body.status || "").trim() as CandidateStatus;
  if (!CANDIDATE_STATUSES.includes(target)) {
    return Response.json({ ok: false, error: `invalid status: ${target}` }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: cur, error: readErr } = await sb
    .from("candidates")
    .select("id, entity_id, status, status_history, job_opening_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!cur) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  if (MANAGER_ONLY_STATUS_TARGETS.has(target)) {
    const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: cur.entity_id });
    if (!mgr) {
      return Response.json({ ok: false, error: `manager required to move to ${target}` }, { status: 403 });
    }
  }

  const nextHistory = Array.isArray(cur.status_history) ? [...(cur.status_history as any[])] : [];
  nextHistory.push({
    at: new Date().toISOString(),
    from: cur.status,
    to: target,
    by: uid,
    reason: body.reason ? String(body.reason).slice(0, 500) : null,
  });

  const patch: Record<string, unknown> = {
    status: target,
    status_history: nextHistory,
  };
  if (target === "rejected" && body.reason) {
    patch.rejection_reason = String(body.reason).slice(0, 500);
  }

  const { data, error } = await sb
    .from("candidates")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Timeline entry so the drawer shows the transition alongside touches.
  await sb.from("candidate_touches").insert({
    candidate_id: id,
    channel: "system",
    direction: "outbound",
    notes: `status: ${cur.status} → ${target}${body.reason ? ` (${body.reason})` : ""}`,
    by_user: uid,
  });

  // If we hired someone, mark the opening as filled.
  if (target === "hired" && cur.job_opening_id) {
    await sb
      .from("job_openings")
      .update({ status: "filled", filled_by: uid, filled_at: new Date().toISOString() })
      .eq("id", cur.job_opening_id);
  }

  return Response.json({ ok: true, candidate: data });
}
