import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/prep/list?entity=<uuid>&date=<YYYY-MM-DD>
//   → today's prep list for the entity/date. Empty list is a real answer —
//     no autogenerate. Call POST /api/prep/list/generate explicitly to
//     materialise the templates.
// POST /api/prep/list
//   body { entity_id, service_date, name, station?, quantity?, unit?,
//          per_cover?, target_covers?, notes?, assignee_id? }
//   → { ok, item }

function isUuid(x: string | null | undefined): x is string {
  return !!x && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function isIsoDate(x: string | null | undefined): x is string {
  return !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const date = url.searchParams.get("date");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  if (!isIsoDate(date)) return Response.json({ ok: false, error: "date YYYY-MM-DD required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data, error } = await sb
    .from("prep_lists")
    .select("*")
    .eq("entity_id", entity)
    .eq("service_date", date)
    .order("station", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const items = data || [];
  const done = items.filter((i: any) => i.status === "done").length;
  return Response.json({ ok: true, items, count: items.length, done });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const service_date = String(body?.service_date || "");
  const name = String(body?.name || "").trim();
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!isIsoDate(service_date)) return Response.json({ ok: false, error: "service_date YYYY-MM-DD required" }, { status: 400 });
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const row: any = {
    entity_id,
    service_date,
    name,
    station:       body?.station ?? null,
    quantity:      body?.quantity ?? null,
    unit:          body?.unit ?? null,
    per_cover:     body?.per_cover ?? null,
    target_covers: body?.target_covers ?? null,
    notes:         body?.notes ?? null,
    assignee_id:   isUuid(body?.assignee_id) ? body.assignee_id : null,
    status:        "todo",
  };

  const { data, error } = await sb.from("prep_lists").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, item: data });
}
