import { supabaseServer } from "@/lib/supabaseServer";
import { moveStatus } from "@/lib/hiring-sop-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/candidates/[id]/touch
// Body: { channel?, direction?, notes? }
// Log an outreach or inbound reply against a candidate.

type Body = { channel?: string; direction?: string; notes?: string };

// GET /api/hiring/candidates/[id]/touch  → list touches for a candidate.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb
    .from("candidate_touches")
    .select("id, candidate_id, touched_at, channel, direction, notes, by_user, kind, status, subject, body, body_alt, language")
    .eq("candidate_id", id)
    .order("touched_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, touches: data || [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Body;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: cand, error: readErr } = await sb
    .from("candidates")
    .select("id, entity_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!cand) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const { data, error } = await sb
    .from("candidate_touches")
    .insert({
      candidate_id: id,
      channel: body.channel ? String(body.channel).trim().slice(0, 40) : null,
      direction: body.direction ? String(body.direction).trim().slice(0, 20) : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      by_user: uid,
    })
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Bump candidate's updated_at so the kanban re-orders.
  await sb.from("candidates").update({ updated_at: new Date().toISOString() }).eq("id", id);

  return Response.json({ ok: true, touch: data });
}

// PATCH /api/hiring/candidates/[id]/touch  { touch_id, subject?, body?, body_alt?, status?: "sent" }
// Save edits to a drafted question set, or stamp it sent after Boris sends it
// by hand. Marking sent moves the candidate new → screening.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as {
    touch_id?: string; subject?: string; body?: string; body_alt?: string; status?: string;
  };
  if (!b.touch_id) return Response.json({ ok: false, error: "touch_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const patch: Record<string, unknown> = {};
  if (typeof b.subject === "string") patch.subject = b.subject.slice(0, 300);
  if (typeof b.body === "string") patch.body = b.body.slice(0, 10000);
  if (typeof b.body_alt === "string") patch.body_alt = b.body_alt.slice(0, 10000);
  if (b.status === "sent") {
    patch.status = "sent";
    patch.touched_at = new Date().toISOString();
    patch.notes = "screening questions sent by hand";
  }
  const { data, error } = await sb
    .from("candidate_touches")
    .update(patch)
    .eq("id", b.touch_id)
    .eq("candidate_id", params.id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (b.status === "sent") await moveStatus(sb, params.id, uid, "screening", "questions sent", ["new"]);
  return Response.json({ ok: true, touch: data });
}
