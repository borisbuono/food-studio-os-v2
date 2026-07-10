import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";
import { findTemplate } from "@/lib/advisory/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/onboard
// Finish handler for the six-step onboarding wizard.
//
// Body:
//   {
//     entity_code?: "IFL"|"BM"|"BBH"|"ADV-<slug>",
//     advisory?: { name, city?, country? },      // only when entity is new
//     voice_profile: string,
//     personality_dials: { formality, warmth, brevity },
//     timezone: string,
//     working_hours: { mon:{start,end}, ... },
//     playbooks: [ { name, description, priority, triage_rules } ],
//     billing_tier: "starter"|"pro"|"enterprise"|"advisory",
//   }
//
// Writes assistant_advisory_clients (if new), assistant_config,
// assistant_playbooks and a welcome brief into assistant_briefs. The
// wizard client redirects to /administrate/settings/assistant on ok.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  // 1. Resolve entity_code — either an existing one or a new ADV-<slug>.
  let entity: EntityCode | string = String(body?.entity_code || "").toUpperCase();
  const advisory = body?.advisory as { name?: string; city?: string; country?: string; fiscal_name?: string; cif?: string; contact_email?: string; contact_phone?: string } | undefined;
  const wantsNew = entity === "NEW" || entity === "" || entity === "ADVISORY";

  if (wantsNew) {
    const name = String(advisory?.name || "").trim();
    if (!name) return Response.json({ ok: false, error: "advisory.name required" }, { status: 400 });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "client";
    entity = ("ADV-" + slug).toUpperCase();

    // Insert (or update if the code already exists — idempotent onboarding).
    const { error: advErr } = await sb.from("assistant_advisory_clients").upsert({
      entity_code: entity,
      name,
      city:    advisory?.city || null,
      country: advisory?.country || null,
      billing_tier: body?.billing_tier || "advisory",
      owner_user_id: uid,
    }, { onConflict: "entity_code" });
    if (advErr) return Response.json({ ok: false, error: "advisory: " + advErr.message }, { status: 500 });

    // Sprint #3 — also upsert into the productised advisory_clients table so
    // the row shows up in /administrate/advisor with its full shape (status
    // funnel, template key, contact block). Idempotent by entity_code.
    const templateKey = String((body?.template_key || "blank")).toLowerCase();
    const { error: prodErr } = await sb.from("advisory_clients").upsert({
      entity_code: entity,
      name,
      fiscal_name:   advisory?.fiscal_name   || null,
      cif:           advisory?.cif           || null,
      contact_email: advisory?.contact_email || null,
      contact_phone: advisory?.contact_phone || null,
      primary_advisor_user_id: uid,
      status: "onboarding",
      tier:   ["advisory","pro","enterprise"].includes(body?.billing_tier) ? body.billing_tier : "advisory",
      template_key: templateKey,
    }, { onConflict: "entity_code" });
    if (prodErr) return Response.json({ ok: false, error: "advisory_clients: " + prodErr.message }, { status: 500 });

    // Seed the activation checklist from the template. Additive — repeats
    // are no-ops via the (client, step_key) uniqueness constraint.
    const tpl = findTemplate(templateKey);
    if (tpl) {
      const { data: newClient } = await sb.from("advisory_clients").select("id").eq("entity_code", entity).maybeSingle();
      if (newClient?.id) {
        const rows = tpl.checklist_steps.map((step, i) => ({
          advisory_client_id: newClient.id,
          step_key: step.key,
          label: step.label,
          hint: step.hint || null,
          sort_order: i,
          // The first step ("entity_created") is done by definition — we
          // just created the entity. Everything else starts todo.
          status: step.key === "entity_created" ? "done" : "todo",
          completed_at: step.key === "entity_created" ? new Date().toISOString() : null,
        }));
        await sb.from("advisory_checklist_items").upsert(rows, { onConflict: "advisory_client_id,step_key" });
      }
    }
  } else if (!["IFL","BM","BBH"].includes(entity)) {
    return Response.json({ ok: false, error: "unknown entity_code" }, { status: 400 });
  }

  // 2. Upsert assistant_config.
  const tier = String(body?.billing_tier || "pro");
  const cfgPatch: any = {
    entity_code: entity,
    voice_profile:      String(body?.voice_profile || "").slice(0, 4000),
    personality_dials:  body?.personality_dials || { formality: 0.5, warmth: 0.65, brevity: 0.6 },
    timezone:           String(body?.timezone || "Europe/Madrid"),
    working_hours:      body?.working_hours || {},
    billing_tier:       tier,
    updated_at:         new Date().toISOString(),
  };
  const { error: cfgErr } = await sb.from("assistant_config")
    .upsert(cfgPatch, { onConflict: "entity_code" });
  if (cfgErr) return Response.json({ ok: false, error: "config: " + cfgErr.message }, { status: 500 });

  // 3. Insert playbooks. We do not delete existing ones — the wizard treats
  //    playbook creation as additive so re-running is safe.
  const pbs = Array.isArray(body?.playbooks) ? body.playbooks : [];
  const pbRows = pbs
    .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
    .map((p: any) => ({
      entity_code: entity,
      name: String(p.name).slice(0, 200),
      description: p.description ? String(p.description).slice(0, 1000) : null,
      priority: typeof p.priority === "number" ? p.priority : 100,
      triage_rules: Array.isArray(p.triage_rules) ? p.triage_rules : [],
    }));
  if (pbRows.length) {
    const { error: pbErr } = await sb.from("assistant_playbooks").insert(pbRows);
    if (pbErr) return Response.json({ ok: false, error: "playbooks: " + pbErr.message }, { status: 500 });
  }

  // 4. Welcome brief — prose, not a checklist. We ask the orchestrator to
  //    write one so the brief has the entity's voice from turn zero. If the
  //    API key isn't set we fall back to a static welcome so onboarding
  //    still completes cleanly.
  const config = await orchestrator.getConfig(entity as EntityCode);
  const cap = await orchestrator.getBillingCap(entity as EntityCode);
  const WELCOME_PROMPT =
    "Write a short welcome brief for the operator — three short paragraphs, editorial prose, no lists. " +
    "This is the first time the Assistant is speaking to them. Introduce yourself in the entity's voice, " +
    "explain what you will do for them tomorrow morning, and end with one gentle sentence about the tier they are on (" + tier + ").";
  const gen = await orchestrator.generate({
    context: null, memory: [], config,
    prompt: WELCOME_PROMPT,
    mode: "brief",
  });
  const today = new Date().toISOString().slice(0, 10);
  const briefBody = (gen.ok && gen.text.trim())
    ? gen.text
    : "Welcome. I will be the Assistant on this profile from tomorrow morning. Every day at breakfast I will write you a short brief on what the day is shaped like, what is waiting in the office, and one small thing to lift the day. Nothing is sent without you. You are on the " + tier + " tier.";
  await sb.from("assistant_briefs").upsert({
    entity_code: entity, user_id: uid, date: today, body: briefBody,
  }, { onConflict: "entity_code,user_id,date" });

  // Meter the welcome-brief generation.
  if (gen.ok) {
    await orchestrator.logAction({
      userId: uid, entity, kind: "brief", route: "/administrate/settings/assistant/onboard",
      payload: { welcome: true, tier }, result: gen,
    });
  }

  return Response.json({
    ok: true,
    entity_code: entity,
    tier,
    cap,
    playbooks_created: pbRows.length,
    brief_created: true,
  });
}
