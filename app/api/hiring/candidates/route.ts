import { supabaseServer } from "@/lib/supabaseServer";
import { CANDIDATE_STATUSES } from "@/lib/hiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/hiring/candidates
//
// GET   ?entity=<uuid>&status=<opt>&opening=<opt>   → list
// POST  { entity_id, name, job_opening_id?, phone?, email?, source?,
//         source_ref?, languages?, years_experience?, right_to_work?,
//         cv_url?, notes? } → create in status='new'.

type CreateBody = {
  entity_id?: string;
  job_opening_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  source_ref?: string;
  languages?: string[];
  years_experience?: number;
  right_to_work?: string;
  cv_url?: string;
  notes?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") || "";
  const status = url.searchParams.get("status") || "";
  const opening = url.searchParams.get("opening") || "";
  if (!entity) return Response.json({ ok: false, error: "entity required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let q = sb
    .from("candidates")
    .select(
      "id, entity_id, job_opening_id, name, phone, email, source, source_ref, languages, years_experience, right_to_work, cv_url, status, status_history, rejection_reason, assigned_to, notes, created_at, updated_at, profile, summary, location, availability, review_flags, score, score_reasons, cv_path, parsed_at, retain_until"
    )
    .eq("entity_id", entity)
    .order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (opening) q = q.eq("job_opening_id", opening);

  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, candidates: data || [] });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const entity_id = String(body.entity_id || "").trim();
  const name = String(body.name || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: mem } = await sb.rpc("fn_is_entity_member", { uid, ent: entity_id });
  if (!mem) return Response.json({ ok: false, error: "not a member of this entity" }, { status: 403 });

  const insert: Record<string, unknown> = {
    entity_id,
    job_opening_id: body.job_opening_id ? String(body.job_opening_id) : null,
    name: name.slice(0, 200),
    phone: body.phone ? String(body.phone).trim().slice(0, 50) : null,
    email: body.email ? String(body.email).trim().slice(0, 200) : null,
    source: body.source ? String(body.source).trim().slice(0, 40) : null,
    source_ref: body.source_ref ? String(body.source_ref).slice(0, 200) : null,
    languages: Array.isArray(body.languages)
      ? body.languages.map((s) => String(s).trim().slice(0, 12)).filter(Boolean)
      : null,
    years_experience: typeof body.years_experience === "number" ? body.years_experience : null,
    right_to_work: body.right_to_work ? String(body.right_to_work).trim().slice(0, 40) : null,
    cv_url: body.cv_url ? String(body.cv_url).slice(0, 500) : null,
    notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    status: "new",
    status_history: [{ at: new Date().toISOString(), to: "new", by: uid, reason: "created" }],
  };

  const { data, error } = await sb.from("candidates").insert(insert).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Log the source touch (inbound) so the timeline shows how they arrived.
  if (data?.id && insert.source) {
    await sb.from("candidate_touches").insert({
      candidate_id: data.id,
      channel: insert.source,
      direction: "inbound",
      notes: "candidate created",
      by_user: uid,
    });
  }
  if (!CANDIDATE_STATUSES.includes(data?.status as any)) {
    // sanity guard, should never trigger
  }
  return Response.json({ ok: true, candidate: data });
}
