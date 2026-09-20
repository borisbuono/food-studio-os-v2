import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/prep/item/[id]/status
//   body { status, quantity?, assignee_id?, notes? }
//   → { ok, item }
//
// Statuses: todo | in_progress | done | skipped.
// Transitioning to 'done' stamps completed_at + completed_by; going back
// out of done clears them so a wrongly-ticked box doesn't lie about who
// finished it.

const ALLOWED = new Set(["todo", "in_progress", "done", "skipped"]);

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!isUuid(id)) return Response.json({ ok: false, error: "id uuid required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const status = String(body?.status || "");
  if (!ALLOWED.has(status)) return Response.json({ ok: false, error: "invalid status" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const patch: any = { status };
  if (status === "done") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = u.user.id;
  } else {
    // undo — clear the completion stamps so we don't preserve stale credit
    patch.completed_at = null;
    patch.completed_by = null;
  }
  if (body?.quantity !== undefined) patch.quantity = body.quantity;
  if (body?.notes !== undefined) patch.notes = body.notes ?? null;
  if (body?.assignee_id !== undefined) {
    patch.assignee_id = isUuid(body.assignee_id) ? body.assignee_id : null;
  }

  const { data, error } = await sb.from("prep_lists").update(patch).eq("id", id).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, item: data });
}
