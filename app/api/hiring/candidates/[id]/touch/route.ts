import { supabaseServer } from "@/lib/supabaseServer";

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
    .select("id, candidate_id, touched_at, channel, direction, notes, by_user")
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
