import { supabaseServer } from "@/lib/supabaseServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { isUuid } from "@/lib/cleaning/server";
import { parseItems } from "@/lib/cleaning/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQ = new Set(["daily", "weekly", "monthly", "opening", "closing"]);

// PATCH /api/cleaning/templates/[id] { name?, area?, frequency?, weekday?, items?, active?, reviewed? } — managers.
// Templates are never deleted: active=false retires one (the runs it made keep
// their snapshot name). reviewed=true clears metadata.needs_boris_review.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!isUuid(id)) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: cur, error: e0 } = await sb.from("cleaning_templates").select("id, entity_id, metadata").eq("id", id).maybeSingle();
  if (e0) return Response.json({ ok: false, error: e0.message }, { status: 500 });
  if (!cur) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const who = await cleaningCaller((cur as any).entity_id);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.isManager) return Response.json({ ok: false, error: "managers only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: who.uid };
  if (body?.name !== undefined) { const n = String(body.name).trim().slice(0, 120); if (n) patch.name = n; }
  if (body?.area !== undefined) patch.area = body.area ? String(body.area).slice(0, 60) : null;
  if (body?.frequency !== undefined && FREQ.has(String(body.frequency))) patch.frequency = String(body.frequency);
  if (body?.weekday !== undefined) patch.weekday = body.weekday == null ? null : Math.min(7, Math.max(1, Number(body.weekday) || 1));
  if (body?.items !== undefined) patch.items = parseItems(body.items);
  if (body?.active !== undefined) patch.active = !!body.active;
  if (body?.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 100;
  if (body?.reviewed === true) patch.metadata = { ...((cur as any).metadata || {}), needs_boris_review: false, reviewed_at: new Date().toISOString() };
  const { data, error } = await sb.from("cleaning_templates").update(patch).eq("id", id).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}
