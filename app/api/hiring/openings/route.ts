import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/hiring/openings
//
// GET   ?entity=<uuid>&status=<open|paused|closed|filled|draft>  → list
// POST  { entity_id, title, role?, station?, description?, hours_per_week?,
//         hourly_rate_eur?, start_date?, languages_required?, status? } → create

type CreateBody = {
  entity_id?: string;
  title?: string;
  role?: string;
  station?: string;
  description?: string;
  hours_per_week?: number;
  hourly_rate_eur?: number;
  start_date?: string;
  languages_required?: string[];
  status?: string;
};

const ALLOWED_STATUS = new Set(["draft", "open", "paused", "closed", "filled"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") || "";
  const status = url.searchParams.get("status") || "";
  if (!entity) return Response.json({ ok: false, error: "entity required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let q = sb
    .from("job_openings")
    .select(
      "id, entity_id, title, role, station, description, hours_per_week, hourly_rate_eur, start_date, languages_required, status, filled_by, filled_at, created_by, created_at, updated_at"
    )
    .eq("entity_id", entity)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, openings: data || [] });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const entity_id = String(body.entity_id || "").trim();
  const title = String(body.title || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!title) return Response.json({ ok: false, error: "title required" }, { status: 400 });

  const status = body.status && ALLOWED_STATUS.has(body.status) ? body.status : "open";

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: mem } = await sb.rpc("fn_is_entity_member", { uid, ent: entity_id });
  if (!mem) return Response.json({ ok: false, error: "not a member of this entity" }, { status: 403 });

  const insert = {
    entity_id,
    title: title.slice(0, 200),
    role: body.role ? String(body.role).trim().slice(0, 40) : null,
    station: body.station ? String(body.station).trim().slice(0, 80) : null,
    description: body.description ? String(body.description).slice(0, 20000) : null,
    hours_per_week: typeof body.hours_per_week === "number" ? body.hours_per_week : null,
    hourly_rate_eur: typeof body.hourly_rate_eur === "number" ? body.hourly_rate_eur : null,
    start_date: body.start_date ? String(body.start_date) : null,
    languages_required: Array.isArray(body.languages_required)
      ? body.languages_required.map((s) => String(s).trim().slice(0, 12)).filter(Boolean)
      : null,
    status,
    created_by: uid,
  };

  const { data, error } = await sb.from("job_openings").insert(insert).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, opening: data });
}
