import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/hiring/interviews/[id]
// Body: { status?, score_1_10?, strengths?, concerns?, recommendation?, notes?,
//         scheduled_at?, format?, location?, interviewer_ids? }
// Update an interview record — the outcome after it happened, or reschedule.

const STATUSES = new Set(["scheduled", "completed", "cancelled", "no-show"]);
const RECOMMENDATIONS = new Set(["hire", "reject", "second-round", "undecided"]);

type Body = {
  status?: string;
  score_1_10?: number;
  strengths?: string;
  concerns?: string;
  recommendation?: string;
  notes?: string;
  scheduled_at?: string;
  format?: string;
  location?: string;
  interviewer_ids?: string[];
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Body;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return Response.json({ ok: false, error: `invalid status: ${body.status}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.recommendation !== undefined) {
    if (body.recommendation && !RECOMMENDATIONS.has(body.recommendation)) {
      return Response.json({ ok: false, error: `invalid recommendation: ${body.recommendation}` }, { status: 400 });
    }
    patch.recommendation = body.recommendation || null;
  }
  if (typeof body.score_1_10 === "number") {
    if (body.score_1_10 < 1 || body.score_1_10 > 10) {
      return Response.json({ ok: false, error: "score_1_10 must be 1..10" }, { status: 400 });
    }
    patch.score_1_10 = Math.round(body.score_1_10);
  }
  if (body.strengths !== undefined) patch.strengths = body.strengths?.slice(0, 4000) || null;
  if (body.concerns !== undefined) patch.concerns = body.concerns?.slice(0, 4000) || null;
  if (body.notes !== undefined) patch.notes = body.notes?.slice(0, 4000) || null;
  if (body.format !== undefined) patch.format = body.format?.slice(0, 40) || null;
  if (body.location !== undefined) patch.location = body.location?.slice(0, 200) || null;
  if (body.scheduled_at !== undefined) {
    const d = new Date(body.scheduled_at);
    if (isNaN(d.getTime())) return Response.json({ ok: false, error: "invalid scheduled_at" }, { status: 400 });
    patch.scheduled_at = d.toISOString();
  }
  if (body.interviewer_ids !== undefined) {
    patch.interviewer_ids = Array.isArray(body.interviewer_ids)
      ? body.interviewer_ids.map((s) => String(s)).filter(Boolean)
      : null;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("interviews")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Log a touch when a completed outcome is recorded.
  if (data && (patch.status || patch.recommendation)) {
    await sb.from("candidate_touches").insert({
      candidate_id: data.candidate_id,
      channel: "system",
      direction: "outbound",
      notes: `interview ${data.status}${data.recommendation ? ` · ${data.recommendation}` : ""}${
        data.score_1_10 ? ` · ${data.score_1_10}/10` : ""
      }`,
      by_user: uid,
    });
  }

  return Response.json({ ok: true, interview: data });
}
