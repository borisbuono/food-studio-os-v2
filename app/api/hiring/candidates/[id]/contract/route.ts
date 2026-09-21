import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET   /api/hiring/candidates/[id]/contract  → the onboarding membership + contract pack
// PATCH /api/hiring/candidates/[id]/contract  { contract: {...} }  manager only
// The pack is a checklist, not the documents: DNI/NSS/IBAN are collected by
// the gestoría, never typed in here.
const STAGES = ["to_prepare", "sent_to_gestoria", "signed", "alta_done"];

async function load(sb: ReturnType<typeof supabaseServer>, id: string) {
  const { data: c } = await sb.from("candidates").select("id, entity_id, team_member_id").eq("id", id).maybeSingle();
  if (!c?.team_member_id) return { c, m: null };
  const { data: m } = await sb
    .from("memberships")
    .select("id, role, area, status, started_at, metadata")
    .eq("person_id", c.team_member_id)
    .eq("entity_id", c.entity_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { c, m };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { m } = await load(sb, params.id);
  return Response.json({ ok: true, membership: m });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { contract?: any };
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { c, m } = await load(sb, params.id);
  if (!c || !m) return Response.json({ ok: false, error: "not on the team yet" }, { status: 404 });
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: c.entity_id });
  if (!mgr) return Response.json({ ok: false, error: "manager required" }, { status: 403 });
  const cur = ((m.metadata as any)?.contract || {}) as any;
  const x = b.contract || {};
  const next = {
    ...cur,
    stage: STAGES.includes(x.stage) ? x.stage : cur.stage,
    start_date: typeof x.start_date === "string" ? x.start_date.slice(0, 10) : cur.start_date,
    contract_type: typeof x.contract_type === "string" ? x.contract_type.slice(0, 40) : cur.contract_type,
    hours_per_week: typeof x.hours_per_week === "number" ? x.hours_per_week : cur.hours_per_week,
    gross_salary: typeof x.gross_salary === "string" ? x.gross_salary.slice(0, 60) : cur.gross_salary,
    docs: { ...(cur.docs || {}), ...(typeof x.docs === "object" && x.docs ? Object.fromEntries(Object.entries(x.docs).map(([k, v]) => [k, !!v])) : {}) },
    notes: typeof x.notes === "string" ? x.notes.slice(0, 2000) : cur.notes,
  };
  const patch: Record<string, unknown> = { metadata: { ...(m.metadata as any), contract: next } };
  if (typeof x.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.start_date)) patch.started_at = x.start_date;
  if (next.stage === "alta_done") patch.status = "active";
  const { data, error } = await sb.from("memberships").update(patch).eq("id", m.id).select("id, role, area, status, started_at, metadata").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, membership: data });
}
