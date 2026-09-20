import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/hiring/openings/[id]
// Update title, description, JD-fields, status. Setting status → 'filled'
// requires manager and sets filled_by/filled_at.

type PatchBody = {
  title?: string;
  role?: string;
  station?: string;
  description?: string;
  hours_per_week?: number | null;
  hourly_rate_eur?: number | null;
  start_date?: string | null;
  languages_required?: string[] | null;
  status?: string;
};

const ALLOWED_STATUS = new Set(["draft", "open", "paused", "closed", "filled"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as PatchBody;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  // Load to know entity_id (RLS ensures we can only see rows in our entities).
  const { data: cur, error: readErr } = await sb
    .from("job_openings")
    .select("id, entity_id, status")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!cur) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
  if (typeof body.role === "string") patch.role = body.role.trim().slice(0, 40) || null;
  if (typeof body.station === "string") patch.station = body.station.trim().slice(0, 80) || null;
  if (typeof body.description === "string") patch.description = body.description.slice(0, 20000);
  if ("hours_per_week" in body) patch.hours_per_week = body.hours_per_week ?? null;
  if ("hourly_rate_eur" in body) patch.hourly_rate_eur = body.hourly_rate_eur ?? null;
  if ("start_date" in body) patch.start_date = body.start_date ?? null;
  if ("languages_required" in body) {
    patch.languages_required = Array.isArray(body.languages_required)
      ? body.languages_required.map((s) => String(s).trim().slice(0, 12)).filter(Boolean)
      : null;
  }

  if (body.status && ALLOWED_STATUS.has(body.status)) {
    if (body.status === "filled") {
      const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: cur.entity_id });
      if (!mgr) return Response.json({ ok: false, error: "manager required to mark filled" }, { status: 403 });
      patch.status = "filled";
      patch.filled_by = uid;
      patch.filled_at = new Date().toISOString();
    } else {
      patch.status = body.status;
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("job_openings")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, opening: data });
}
