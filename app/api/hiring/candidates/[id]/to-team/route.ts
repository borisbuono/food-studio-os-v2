import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/candidates/[id]/to-team   { role?, area?, start_date? }   manager only
// The candidate becomes a person on the team: a team_members row (status
// 'invited', no invitation email is sent from here) + a membership in
// status 'onboarding' carrying the contract pack. Candidate → hired, linked,
// retention cleared (hired people are kept under employment rules, not the
// 12-month candidate rule).
const ROLES = new Set(["worker", "chef", "maitre", "manager"]);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { role?: string; area?: string; start_date?: string };
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: c } = await sb
    .from("candidates")
    .select("id, entity_id, name, email, phone, status, status_history, answers, lang, team_member_id, job_opening_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: c.entity_id });
  if (!mgr) return Response.json({ ok: false, error: "manager required" }, { status: 403 });
  if (c.team_member_id) return Response.json({ ok: true, team_member_id: c.team_member_id, already: true });
  if (!c.email) return Response.json({ ok: false, error: "candidate has no email — add it first" }, { status: 400 });

  const area = b.area === "foh" || b.area === "boh" ? b.area : (c.answers as any)?.area === "sala" ? "foh" : "boh";
  const role = ROLES.has(String(b.role)) ? String(b.role) : "worker";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || "")) ? String(b.start_date) : new Date().toISOString().slice(0, 10);

  // Reuse an existing person with the same email in this house.
  const { data: existing } = await sb
    .from("team_members")
    .select("id")
    .eq("operator_entity_id", c.entity_id)
    .ilike("email", String(c.email))
    .maybeSingle();
  let personId = existing?.id as string | undefined;
  if (!personId) {
    const { data: tm, error } = await sb
      .from("team_members")
      .insert({
        operator_entity_id: c.entity_id,
        email: String(c.email).toLowerCase(),
        name: c.name,
        phone: c.phone,
        default_role: role,
        default_area: area,
        language: c.lang === "en" ? "en" : "es",
        status: "invited",
        invited_by: uid,
        metadata: { source: "hiring", candidate_id: c.id, invite_pending: true },
      })
      .select("id")
      .single();
    if (error || !tm) return Response.json({ ok: false, error: error?.message || "could not create team member" }, { status: 500 });
    personId = tm.id as string;
  }

  const contract = {
    stage: "to_prepare", // to_prepare → sent_to_gestoria → signed → alta_done
    start_date: start,
    contract_type: null,
    hours_per_week: null,
    gross_salary: null,
    docs: { dni_nie: false, nss: false, iban: false, address: false, carnet_manipulador: false },
    notes: "",
  };
  const { error: mErr } = await sb.from("memberships").insert({
    person_id: personId,
    entity_id: c.entity_id,
    role,
    area,
    status: "onboarding",
    started_at: start,
    metadata: { source: "hiring", candidate_id: c.id, contract },
  });
  if (mErr) return Response.json({ ok: false, error: mErr.message }, { status: 500 });

  const hist = Array.isArray(c.status_history) ? [...(c.status_history as any[])] : [];
  hist.push({ at: new Date().toISOString(), from: c.status, to: "hired", by: uid, reason: "moved to team" });
  await sb.from("candidates").update({ team_member_id: personId, status: "hired", status_history: hist, retain_until: null }).eq("id", c.id);
  await sb.from("candidate_touches").insert({
    candidate_id: c.id, channel: "system", direction: "outbound", notes: `hired → team member (${role}, ${area}), onboarding from ${start}`, by_user: uid,
  });
  if (c.job_opening_id)
    await sb.from("job_openings").update({ status: "filled", filled_by: uid, filled_at: new Date().toISOString() }).eq("id", c.job_opening_id);
  return Response.json({ ok: true, team_member_id: personId });
}
