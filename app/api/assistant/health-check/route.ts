import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/health-check  { entity: "IFL"|"BM"|"BBH"|"ADV-..." }
// Runs a short diagnostic across the orchestrator + edges for a given
// profile: config present, playbooks present, at least one channel wired,
// billing tier resolvable, cap not exceeded, model reachable (a 60-token
// generate). Returns a report the Holdings admin surface can render.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = String(body?.entity || "").toUpperCase() as EntityCode | string;
  if (!entity) return Response.json({ ok: false, error: "entity required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const report: Record<string, { ok: boolean; detail: string }> = {};

  // 1. Config present?
  const cfg = await orchestrator.getConfig(entity as EntityCode);
  report.config = cfg
    ? { ok: true,  detail: "voice profile " + (cfg.voice_profile ? "set" : "empty") + ", " + Object.keys(cfg.working_hours || {}).length + " days configured" }
    : { ok: false, detail: "no assistant_config row for " + entity };

  // 2. Playbooks?
  const { data: pbs, error: pbErr } = await sb.from("assistant_playbooks").select("id,name").eq("entity_code", entity);
  report.playbooks = pbErr
    ? { ok: false, detail: pbErr.message }
    : { ok: (pbs?.length || 0) > 0, detail: (pbs?.length || 0) + " playbook(s) configured" };

  // 3. Channels? Scoped to the requesting user because channels are
  //    per-user; this checks that at least Boris has one.
  const { data: chans } = await sb.from("assistant_channels")
    .select("id,channel_type").eq("user_id", u.user.id).is("revoked_at", null);
  report.channels = { ok: (chans?.length || 0) > 0, detail: (chans?.length || 0) + " channel(s) live for the current operator" };

  // 4. Billing cap.
  const cap = await orchestrator.getBillingCap(entity);
  report.billing = cap
    ? { ok: !cap.exceeded, detail: "tier=" + cap.tier + ", used " + cap.actions_used + "/" + cap.actions_cap + " actions, €" + cap.cost_used_eur.toFixed(2) + "/€" + cap.cost_cap_eur.toFixed(2) }
    : { ok: false, detail: "no billing tier resolvable for entity" };

  // 5. Model reachable? Cheap 60-token ping.
  let modelReport: { ok: boolean; detail: string };
  if (cap?.exceeded) {
    modelReport = { ok: false, detail: "skipped — billing cap exceeded" };
  } else {
    const ping = await orchestrator.generate({
      context: null, memory: [], config: cfg,
      prompt: "Reply with the single word 'ready'.",
      mode: "chat",
    });
    modelReport = ping.ok
      ? { ok: true,  detail: "model " + ping.model + " ok · " + ping.latency_ms + "ms · €" + (ping.cost_eur ?? 0).toFixed(6) }
      : { ok: false, detail: "generate failed: " + (ping.text || "unknown error") };
  }
  report.model = modelReport;

  const ok = Object.values(report).every((r) => r.ok);

  // Meter the health check itself so it shows up in usage.
  await orchestrator.logAction({
    userId: u.user.id, entity, kind: "chat", route: "/api/assistant/health-check",
    payload: { report, health_ok: ok }, result: null,
  });

  return Response.json({ ok, entity, report });
}
