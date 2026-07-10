import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/assistant/memory/[id]
// Body: { fact?, kind?, tags?, confirm? }
// Confirm bumps confirmed_at (marking the row as endorsed by the operator).
// Fact / kind / tags patch the row directly.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const patch: any = {};
  if (typeof body?.fact === "string" && body.fact.trim())     patch.fact = String(body.fact).trim().slice(0, 500);
  if (typeof body?.kind === "string")                          patch.kind = body.kind;
  if (Array.isArray(body?.tags))                               patch.tags = body.tags.map((t: any) => String(t).slice(0, 40)).filter(Boolean).slice(0, 8);
  if (body?.confirm === true)                                  patch.confirmed_at = new Date().toISOString();

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await sb.from("assistant_memory")
    .update(patch)
    .eq("id", id)
    .eq("user_id", uid)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, memory: data });
}

// DELETE /api/assistant/memory/[id]
// Soft-retires the row (sets retired_at) so it stops appearing but stays
// auditable.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { error } = await sb.from("assistant_memory")
    .update({ retired_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", uid);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
