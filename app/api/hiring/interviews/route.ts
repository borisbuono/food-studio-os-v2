import { supabaseServer } from "@/lib/supabaseServer";
import { myPersonIds } from "@/lib/calendar.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hiring/interviews?candidate=<uuid>  → list interviews for a candidate.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const candidate = url.searchParams.get("candidate") || "";
  if (!candidate) return Response.json({ ok: false, error: "candidate required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb
    .from("interviews")
    .select("id, candidate_id, scheduled_at, format, location, status, score_1_10, recommendation, notes")
    .eq("candidate_id", candidate)
    .order("scheduled_at", { ascending: false });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, interviews: data || [] });
}

// POST /api/hiring/interviews
// Body: { candidate_id, scheduled_at (ISO), format?, location?, interviewer_ids?[], notes? }
// Bumps the candidate to status='interview' if still earlier in the funnel.

type Body = {
  candidate_id?: string;
  scheduled_at?: string;
  format?: string;
  location?: string;
  interviewer_ids?: string[];
  notes?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const candidate_id = String(body.candidate_id || "").trim();
  if (!candidate_id) return Response.json({ ok: false, error: "candidate_id required" }, { status: 400 });
  const scheduled_at = body.scheduled_at ? new Date(body.scheduled_at) : null;
  if (!scheduled_at || isNaN(scheduled_at.getTime())) {
    return Response.json({ ok: false, error: "scheduled_at (ISO) required" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: cand, error: readErr } = await sb
    .from("candidates")
    .select("id, entity_id, status, status_history")
    .eq("id", candidate_id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!cand) return Response.json({ ok: false, error: "candidate not found" }, { status: 404 });

  const myIds = await myPersonIds();
  const { data, error } = await sb
    .from("interviews")
    .insert({
      candidate_id,
      scheduled_at: scheduled_at.toISOString(),
      format: body.format ? String(body.format).trim().slice(0, 40) : null,
      location: body.location ? String(body.location).trim().slice(0, 200) : null,
      // Default the interviewer to whoever schedules it, so the interview lands
      // on their /me/calendar (calendar _hr_wire, 2026-09-21).
      interviewer_ids: Array.isArray(body.interviewer_ids) && body.interviewer_ids.length
        ? body.interviewer_ids.map((s) => String(s)).filter(Boolean)
        : myIds.length ? [myIds[0]] : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      status: "scheduled",
    })
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Promote to interview stage if still earlier in the funnel.
  const earlier = new Set(["new", "screening"]);
  if (earlier.has(cand.status)) {
    const hist = Array.isArray(cand.status_history) ? [...(cand.status_history as any[])] : [];
    hist.push({
      at: new Date().toISOString(),
      from: cand.status,
      to: "interview",
      by: uid,
      reason: "interview scheduled",
    });
    await sb
      .from("candidates")
      .update({ status: "interview", status_history: hist })
      .eq("id", candidate_id);
  }

  await sb.from("candidate_touches").insert({
    candidate_id,
    channel: "system",
    direction: "outbound",
    notes: `interview scheduled for ${scheduled_at.toISOString()}`,
    by_user: uid,
  });

  return Response.json({ ok: true, interview: data });
}
