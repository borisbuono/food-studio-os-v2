import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/hiring/candidates/[id]   manager only — erase a candidate (GDPR
// deletion request, test rows): CV file, interviews, touches, row.
// Refuses once the person is on the team: that data is employment data now.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: c } = await sb.from("candidates").select("id, entity_id, cv_path, team_member_id").eq("id", params.id).maybeSingle();
  if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: c.entity_id });
  if (!mgr) return Response.json({ ok: false, error: "manager required" }, { status: 403 });
  if (c.team_member_id) return Response.json({ ok: false, error: "already on the team — remove from the team instead" }, { status: 409 });
  if (c.cv_path) await sb.storage.from("hiring-cvs").remove([String(c.cv_path)]);
  await sb.from("interviews").delete().eq("candidate_id", c.id);
  await sb.from("candidate_touches").delete().eq("candidate_id", c.id);
  const { error } = await sb.from("candidates").delete().eq("id", c.id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
