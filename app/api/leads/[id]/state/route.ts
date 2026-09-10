// PATCH /api/leads/[id]/state
//
// Auth-gated. Advances a lead through the state machine and appends a
// system touch row so /studio/growth can show the transition on the
// timeline. Body: { state, notes? }.

import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATES = new Set(["new", "contacted", "qualified", "converted", "lost"]);

export async function PATCH(
  req: Request,
  ctx: { params: { id: string } },
) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const uid = userRes.user.id;
  const leadId = ctx.params.id;
  if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) {
    return Response.json({ ok: false, error: "bad lead id" }, { status: 400 });
  }

  let body: { state?: string; notes?: string; lost_reason?: string } = {};
  try { body = await req.json(); } catch { /* keep body empty */ }

  const state = String(body.state || "").toLowerCase();
  if (!ALLOWED_STATES.has(state)) {
    return Response.json({ ok: false, error: "bad state" }, { status: 400 });
  }
  const notes = body.notes ? String(body.notes).slice(0, 4000) : null;
  const lostReason = state === "lost" && body.lost_reason ? String(body.lost_reason).slice(0, 400) : null;

  // Load current row for state_history append.
  const { data: existing, error: readErr } = await sb
    .from("leads")
    .select("id, state, state_history")
    .eq("id", leadId)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!existing) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const priorHistory = Array.isArray((existing as any).state_history) ? (existing as any).state_history : [];
  const transition = {
    at: new Date().toISOString(),
    from: (existing as any).state,
    to: state,
    by: uid,
    notes,
  };
  const nextHistory = [...priorHistory, transition];

  const updatePayload: Record<string, unknown> = {
    state,
    state_history: nextHistory,
  };
  if (lostReason) updatePayload.lost_reason = lostReason;

  const { error: upErr } = await sb.from("leads").update(updatePayload).eq("id", leadId);
  if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 });

  // System touch for the timeline.
  await sb.from("lead_touches").insert({
    lead_id: leadId,
    channel: "system",
    direction: "internal",
    notes: `state → ${state}${notes ? " · " + notes : ""}`,
    by_user: uid,
  });

  return Response.json({ ok: true });
}
