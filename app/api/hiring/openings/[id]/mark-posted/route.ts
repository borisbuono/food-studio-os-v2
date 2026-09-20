import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/openings/[id]/mark-posted
// Body: { post_id: uuid, external_ref?: string }
//
// After Boris pastes a drafted post into WhatsApp/etc. by hand, he taps
// "mark posted" and we stamp posted_at + posted_by + status='posted'.

type Body = { post_id?: string; external_ref?: string };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const opening_id = String(params.id || "").trim();
  const body = (await req.json().catch(() => ({}))) as Body;
  const post_id = String(body.post_id || "").trim();
  if (!post_id) return Response.json({ ok: false, error: "post_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: cur, error: readErr } = await sb
    .from("job_posts")
    .select("id, job_opening_id, status")
    .eq("id", post_id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!cur) return Response.json({ ok: false, error: "post not found" }, { status: 404 });
  if (opening_id && cur.job_opening_id !== opening_id) {
    return Response.json({ ok: false, error: "post/opening mismatch" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("job_posts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_by: uid,
      external_ref: body.external_ref ? String(body.external_ref).slice(0, 200) : null,
    })
    .eq("id", post_id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, post: data });
}
