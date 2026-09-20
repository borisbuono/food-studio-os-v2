import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/prep/templates?entity=<uuid>
//   → { ok, templates: [{ ...template, items: [...] }] }
// POST /api/prep/templates
//   body { entity_id, name, station?, active?, applies_days_of_week?[] }
//   → { ok, template }

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: templates, error } = await sb
    .from("prep_templates")
    .select("*")
    .eq("entity_id", entity)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const ids = (templates || []).map((t: any) => t.id);
  let itemsByTemplate: Record<string, any[]> = {};
  if (ids.length) {
    const { data: items, error: iErr } = await sb
      .from("prep_template_items")
      .select("*")
      .in("template_id", ids)
      .order("sort_order", { ascending: true });
    if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });
    for (const it of items || []) {
      (itemsByTemplate[it.template_id] ||= []).push(it);
    }
  }

  return Response.json({
    ok: true,
    templates: (templates || []).map((t: any) => ({ ...t, items: itemsByTemplate[t.id] || [] })),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const name = String(body?.name || "").trim();
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  let dow: number[] | null = null;
  if (Array.isArray(body?.applies_days_of_week)) {
    dow = body.applies_days_of_week
      .map((n: any) => Number(n))
      .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (dow!.length === 0) dow = null;
  }

  const row = {
    entity_id,
    name,
    station: body?.station ?? null,
    active: body?.active === undefined ? true : !!body.active,
    applies_days_of_week: dow,
  };

  const { data, error } = await sb.from("prep_templates").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}
