import { supabaseServer } from "@/lib/supabaseServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { isUuid } from "@/lib/cleaning/server";
import { parseItems } from "@/lib/cleaning/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQ = new Set(["daily", "weekly", "monthly", "opening", "closing"]);

// GET /api/cleaning/templates?entity=<uuid> — the house's templates (members).
export async function GET(req: Request) {
  const entity = new URL(req.url).searchParams.get("entity");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  const who = await cleaningCaller(entity);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  const { data, error } = await supabaseServer().from("cleaning_templates").select("*").eq("entity_id", entity).order("sort_order").order("name");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, templates: data || [], is_manager: who.isManager });
}

// POST /api/cleaning/templates { entity_id, name, area?, frequency, weekday?, items: [{label}|string] } — managers.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = body?.entity_id;
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  const who = await cleaningCaller(entity_id);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.isManager) return Response.json({ ok: false, error: "managers only" }, { status: 403 });
  const name = String(body?.name || "").trim().slice(0, 120);
  const frequency = String(body?.frequency || "");
  if (!name || !FREQ.has(frequency)) return Response.json({ ok: false, error: "name + frequency required" }, { status: 400 });
  const weekday = frequency === "weekly" ? Math.min(7, Math.max(1, Number(body?.weekday) || 1)) : null;
  const row = {
    entity_id, name, frequency, weekday,
    area: body?.area ? String(body.area).slice(0, 60) : null,
    items: parseItems(body?.items),
    sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 100,
    metadata: { source: "manager", created_via: "app" },
    updated_by: who.uid,
  };
  const { data, error } = await supabaseServer().from("cleaning_templates").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}
