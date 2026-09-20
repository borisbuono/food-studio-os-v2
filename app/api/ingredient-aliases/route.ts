import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

// GET  /api/ingredient-aliases?entity=<uuid>
//   → { ok, aliases: [{ id, canonical_name, alias, unit, unit_conversion }] }
// POST /api/ingredient-aliases
//   body { entity_id, canonical_name, alias, unit?, unit_conversion? }
//   → { ok, alias }
// PATCH /api/ingredient-aliases
//   body { id, canonical_name?, alias?, unit?, unit_conversion? }
// DELETE /api/ingredient-aliases?id=<uuid>

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isUuid(entity)) return NextResponse.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data, error } = await sb
    .from("ingredient_aliases")
    .select("id, canonical_name, alias, unit, unit_conversion, created_at")
    .eq("entity_id", entity)
    .order("canonical_name", { ascending: true })
    .order("alias", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, aliases: data || [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = String(body?.entity_id || "");
  const canonical_name = String(body?.canonical_name || "").trim();
  const alias = String(body?.alias || "").trim();
  if (!isUuid(entity_id)) return NextResponse.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!canonical_name)    return NextResponse.json({ ok: false, error: "canonical_name required" }, { status: 400 });
  if (!alias)             return NextResponse.json({ ok: false, error: "alias required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const row = {
    entity_id,
    canonical_name,
    alias,
    unit: body?.unit ?? null,
    unit_conversion: Number.isFinite(Number(body?.unit_conversion)) ? Number(body.unit_conversion) : 1,
  };
  const { data, error } = await sb.from("ingredient_aliases").insert(row).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, alias: data });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const patch: Record<string, any> = {};
  for (const k of ["canonical_name", "alias", "unit"]) if (k in body) patch[k] = body[k];
  if ("unit_conversion" in body) patch.unit_conversion = Number(body.unit_conversion) || 1;

  const { data, error } = await sb.from("ingredient_aliases").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, alias: data });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { error } = await sb.from("ingredient_aliases").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
