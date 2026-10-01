import { isIsoDate, isManager, mondayOf, requireUser } from "@/lib/rota/server";
import { explainProposal } from "@/lib/rota/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota S3 — "Suggest cheaper rota" (the reverse of ruling 1).
// GET  /api/rota/propose?entity=&week=          → latest open proposal for the week (if any) + forecast
// POST /api/rota/propose { entity_id, week_start, action: "create" | "accept" | "decline", proposal_id?, line_id?, new_shift_id?, lang? }
//   create  → fn_rota_propose (SQL does the arithmetic, per service and area: remove | shorten | extend | add lines with € delta and the
//             forecast-vs-band reason) + a one-paragraph explanation (Haiku if a key is set, template otherwise)
//   accept  → fn_rota_proposal_accept(proposal, line_id, true, new_shift_id?) — applies THAT line only; an "add" line needs the shift the
//             manager created (they pick who works it; the OS never does)
//   decline → fn_rota_proposal_accept(proposal, line_id, false)
// Nothing is applied without the manager's tap on each line (ruling C).

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity_id = String(u.searchParams.get("entity") || "");
  const wk = String(u.searchParams.get("week") || "");
  if (!entity_id) return Response.json({ ok: false, error: "entity required" }, { status: 400 });
  const week_start = mondayOf(isIsoDate(wk) ? wk : new Date().toISOString().slice(0, 10));
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const [pRes, fRes] = await Promise.all([
    sb.from("rota_proposals").select("*").eq("entity_id", entity_id).eq("week_start", week_start).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.rpc("fn_rota_forecast", { p_entity: entity_id, p_week_start: week_start }),
  ]);
  return Response.json({ ok: true, week_start, proposal: pRes.data || null, forecast: fRes.data || [] });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entity_id = String(body.entity_id || "");
  const action = String(body.action || "create");
  if (!entity_id || !isIsoDate(body.week_start)) return Response.json({ ok: false, error: "entity_id + week_start required" }, { status: 400 });
  const week_start = mondayOf(body.week_start);
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  if (!(await isManager(sb, uid, entity_id))) return Response.json({ ok: false, error: "manager required" }, { status: 403 });

  if (action === "create") {
    const { data, error } = await sb.rpc("fn_rota_propose", { p_entity: entity_id, p_week_start: week_start });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    const p = (Array.isArray(data) ? data[0] : data) as any;
    const lang = body.lang === "es" ? "es" : "en";
    const explanation = await explainProposal({ before_eur: Number(p.before_eur), after_eur: Number(p.after_eur), items: p.items || [], warnings: p.warnings || [] }, lang);
    await sb.rpc("fn_rota_proposal_explain", { p_proposal: p.id, p_text: explanation });
    return Response.json({ ok: true, proposal: { ...p, explanation } });
  }
  if (action === "accept" || action === "decline") {
    const proposal_id = String(body.proposal_id || ""), line_id = String(body.line_id || "");
    if (!proposal_id || !line_id) return Response.json({ ok: false, error: "proposal_id + line_id required" }, { status: 400 });
    const { data, error } = await sb.rpc("fn_rota_proposal_accept", { p_proposal: proposal_id, p_line: line_id, p_accept: action === "accept", p_new_shift: body.new_shift_id ? String(body.new_shift_id) : null });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, proposal: Array.isArray(data) ? data[0] : data });
  }
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
}
