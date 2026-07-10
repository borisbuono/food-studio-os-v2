import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/advisor/clients/[client_id]
// Body: partial advisory_clients row — status, tier, notes, contact fields.
// RLS enforces that only the primary advisor can write.
export async function PATCH(req: Request, { params }: { params: { client_id: string } }) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const clientId = params.client_id;
  const patch: any = { updated_at: new Date().toISOString() };

  // Whitelist fields — never accept a primary_advisor swap through this path
  // (that would let a seat-holder escape the RLS boundary).
  const allowStatus = ["prospect","onboarding","active","paused","churned"];
  const allowTier   = ["advisory","pro","enterprise"];
  if (typeof body.status === "string" && allowStatus.includes(body.status)) {
    patch.status = body.status;
    if (body.status === "active"  && !patch.activated_at) patch.activated_at = new Date().toISOString();
    if (body.status === "paused") patch.paused_at    = new Date().toISOString();
  }
  if (typeof body.tier === "string" && allowTier.includes(body.tier))         patch.tier          = body.tier;
  if (typeof body.notes === "string")                                          patch.notes         = body.notes.slice(0, 4000);
  if (typeof body.contact_email === "string")                                  patch.contact_email = body.contact_email.trim().toLowerCase() || null;
  if (typeof body.contact_phone === "string")                                  patch.contact_phone = body.contact_phone.trim() || null;
  if (typeof body.fiscal_name === "string")                                    patch.fiscal_name   = body.fiscal_name.trim() || null;
  if (typeof body.cif === "string")                                            patch.cif           = body.cif.trim().toUpperCase() || null;

  const { data, error } = await sb
    .from("advisory_clients")
    .update(patch)
    .eq("id", clientId)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data)  return Response.json({ ok: false, error: "not found or not permitted" }, { status: 404 });
  return Response.json({ ok: true, client: data });
}
