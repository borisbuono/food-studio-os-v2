import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/advisor/checklist/[item_id]
// Body: { status?, notes?, owner_user_id? }
// RLS enforces primary-advisor-only writes.
export async function PATCH(req: Request, { params }: { params: { item_id: string } }) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const patch: any = { updated_at: new Date().toISOString() };
  const allowStatus = ["todo","in_progress","done","skipped","blocked"];
  if (typeof body.status === "string" && allowStatus.includes(body.status)) {
    patch.status = body.status;
    if (body.status === "done") patch.completed_at = new Date().toISOString();
  }
  if (typeof body.notes === "string")            patch.notes = body.notes.slice(0, 2000);
  if (typeof body.owner_user_id === "string")    patch.owner_user_id = body.owner_user_id;

  const { data, error } = await sb
    .from("advisory_checklist_items")
    .update(patch)
    .eq("id", params.item_id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data)  return Response.json({ ok: false, error: "not found or not permitted" }, { status: 404 });
  return Response.json({ ok: true, item: data });
}
