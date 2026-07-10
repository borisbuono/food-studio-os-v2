import { supabaseServer } from "@/lib/supabaseServer";
import { slugifyToEntityCode } from "@/lib/advisory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/advisor/clients
// Body: { name, fiscal_name?, cif?, contact_email?, contact_phone?, tier?, notes? }
//
// Creates a new advisory client bound to the calling user as primary
// advisor. Emits an ADV-<slug> entity_code. Idempotent — a repeat call with
// the same slug refreshes the mutable fields.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const name = String(body?.name || "").trim();
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const entity_code = slugifyToEntityCode(name);
  const tier = ["advisory","pro","enterprise"].includes(body?.tier) ? body.tier : "advisory";

  const { data, error } = await sb
    .from("advisory_clients")
    .upsert({
      entity_code,
      name,
      fiscal_name:   body?.fiscal_name?.trim() || null,
      cif:           body?.cif?.trim()?.toUpperCase() || null,
      contact_email: body?.contact_email?.trim()?.toLowerCase() || null,
      contact_phone: body?.contact_phone?.trim() || null,
      notes:         body?.notes?.slice(0, 4000) || null,
      tier,
      status:        "onboarding",
      primary_advisor_user_id: uid,
    }, { onConflict: "entity_code" })
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, client: data });
}
