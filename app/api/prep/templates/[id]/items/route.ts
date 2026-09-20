import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/prep/templates/[id]/items
//   body { name, quantity?, unit?, per_cover?, station?, sort_order? }
//   → { ok, item }

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const template_id = params?.id;
  if (!isUuid(template_id)) return Response.json({ ok: false, error: "template id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  // Verify the template exists (RLS will still gate the insert).
  const { data: tmpl, error: tErr } = await sb
    .from("prep_templates")
    .select("id")
    .eq("id", template_id)
    .maybeSingle();
  if (tErr) return Response.json({ ok: false, error: tErr.message }, { status: 500 });
  if (!tmpl) return Response.json({ ok: false, error: "template not found" }, { status: 404 });

  const row = {
    template_id,
    name,
    quantity:  body?.quantity ?? null,
    unit:      body?.unit ?? null,
    per_cover: body?.per_cover ?? null,
    station:   body?.station ?? null,
    sort_order: Number.isFinite(body?.sort_order) ? Number(body.sort_order) : 0,
  };

  const { data, error } = await sb.from("prep_template_items").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, item: data });
}
