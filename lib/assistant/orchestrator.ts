import { supabaseServer } from "@/lib/supabaseServer";

// The Brain — the Assistant Layer orchestrator.
//
// One class. Central path for every AI turn in the OS: Chef FAB chat, morning
// briefs, later email + WhatsApp triage. The orchestrator owns four things:
//   1. context   — what's going on in the OS right now for this entity + user
//   2. memory    — durable facts the user has taught the assistant
//   3. config    — the entity's voice / personality / working hours
//   4. generate  — call Anthropic with a mode-aware system prompt
//
// Every call is logged into assistant_conversations + assistant_actions so
// billing metering (Sprint 6) can meter tokens by user, by entity, by mode.

export type EntityCode = "IFL" | "BM" | "BBH";
export type AssistantMode = "chat" | "brief" | "draft" | "extract";

export type AssistantContext = {
  entity: EntityCode;
  today: string;
  now_hhmm: string;
  service_phase: "before" | "during" | "after" | "unknown";
  covers_booked: number;
  eod_posted: boolean;
  eod_revenue: number | null;
  open_invoices_count: number;
  open_invoices_total_eur: number;
  bank_unmatched_count: number;
  active_mep_dishes: number;
  urgent_tasks_count: number;
  low_inventory_count: number;
  open_anomalies_count: number;
  top_anomalies: Array<{ kind: string; severity: number; description: string }>;
  onboarding_in_progress: Array<{ name: string; role: string; step_count: number; started: string | null }>;
  ad_reactivation: {
    platform: string;
    status_label: string | null;
    steps_done: number;
    steps_total: number;
    ready: boolean;
    disabled_since: string | null;
  } | null;
  // PA integration Sprint 1 — top open Master_ToDo rows so the FAB can answer
  // "what's on my plate today" without a separate round trip.
  top_master_todos: { title: string; impact_score: number; source: string; due_at: string | null }[];
  // PA integration Sprint 3 — so voice "when's my morning brief?" reads.
  pa_schedule: {
    morning_brief_time?: string;
    evening_debrief_time?: string;
    daily_academy_time?: string;
    whatsapp_triage_hourly?: boolean;
  } | null;
  // Pillars #3 — the user's Academy progress in the current module. Lets the
  // FAB answer "have I finished today's lesson?" / "what am I next in
  // training?" without an extra round trip. Filled from academy_lesson_progress
  // joined against the module_scope tag on academy_lessons.
  academy_progress_current_module: {
    module_scope: "foh" | "boh" | "office" | null;
    total: number;
    done: number;
    in_progress: number;
    next_lesson_title: string | null;
  } | null;
  page_context: any | null;
};

export type AssistantMemoryFact = { fact: string; scope?: string };

export type AssistantConfig = {
  entity_code: EntityCode;
  voice_profile: string;
  personality_dials: { formality: number; warmth: number; brevity: number };
  timezone: string;
  working_hours: Record<string, { start: string; end: string }>;
  quiet_hours: { start: string; end: string };
};

export type GenerateInput = {
  context?: AssistantContext | null;
  memory?: AssistantMemoryFact[];
  history?: { role: "user" | "assistant"; text: string }[];
  config?: AssistantConfig | null;
  prompt: string;
  mode: AssistantMode;
  language?: "en" | "es";
  system_extra?: string;
  // PA integration Sprint 2 — when spawning a sub-agent, pass the
  // charter row so the system prompt binds the agent to its scope.
  charter?: {
    agent_type: string;
    objective: string;
    scope?: string | null;
    constraints?: string | null;
    success_criteria?: string | null;
    deliverables?: any[];
  } | null;
};

export type GenerateOutput = {
  ok: boolean;
  text: string;
  intent: string | null;
  confidence: number | null;
  actions: any[];
  raw_json: any | null;
  cost_usd: number | null;
  cost_eur: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  model: string;
  cap_exceeded?: boolean;
};

export type BillingCap = {
  tier: string;
  actions_used: number;
  actions_cap: number;
  cost_used_eur: number;
  cost_cap_eur: number;
  exceeded: boolean;
};

const CHAT_MODEL   = "claude-haiku-4-5-20251001";
const BRIEF_MODEL  = "claude-haiku-4-5-20251001";
const DRAFT_MODEL  = "claude-haiku-4-5-20251001";
const EXTRACT_MODEL = "claude-haiku-4-5-20251001";

// Anthropic Haiku 4.5 published pricing (USD per million tokens).
// Sprint 6 bills in EUR — convert at a conservative fixed rate that we
// re-tune quarterly. Kept as a constant so the whole billing math is
// auditable in one place.
const PRICE_IN_PER_MTOK_USD  = 0.80;
const PRICE_OUT_PER_MTOK_USD = 4.00;
const USD_EUR_RATE           = 0.92;
const PRICE_IN_PER_MTOK_EUR  = PRICE_IN_PER_MTOK_USD  * USD_EUR_RATE;
const PRICE_OUT_PER_MTOK_EUR = PRICE_OUT_PER_MTOK_USD * USD_EUR_RATE;
// The pre-existing USD math stays alongside so cost_usd in the response
// payload keeps its meaning across the codebase.
const PRICE_IN_PER_MTOK  = PRICE_IN_PER_MTOK_USD;
const PRICE_OUT_PER_MTOK = PRICE_OUT_PER_MTOK_USD;

const ENTITY_TO_RID: Record<EntityCode, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  BBH: "",
};

function madridToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function madridHHmm() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  return hh + ":" + mm;
}

export class AssistantOrchestrator {
  // PA integration Sprint 2 — fetch a charter row so a sub-agent knows its
  // scope before it runs. Returns null if no charter exists.
  async getCharter(charterId: string): Promise<any | null> {
    if (!charterId) return null;
    const sb = supabaseServer();
    const { data } = await sb.from("agent_charters").select("*").eq("id", charterId).maybeSingle();
    return data || null;
  }

  async getContext(entity: EntityCode, userId: string | null, pageContext: any | null): Promise<AssistantContext> {
    const sb = supabaseServer();
    const today = madridToday();
    const rid = ENTITY_TO_RID[entity] || null;

    const cutoff14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const [eod, bookings, invInbox, bank, mep, tasks, anomalies, invitations, masterTodos, paSchedule, academyModuleLessons, academyProgress] = await Promise.all([
      rid ? sb.from("eod_accounting").select("revenue,actual_covers").eq("restaurant_id", rid).eq("report_date", today).maybeSingle() : Promise.resolve({ data: null } as any),
      rid ? sb.from("bookings").select("party_size,status").eq("restaurant_id", rid).eq("service_date", today) : Promise.resolve({ data: [] } as any),
      sb.from("invoice_inbox").select("amount_eur,match_status").eq("entity_id", entity).not("match_status", "in", "(approved,rejected,duplicate)"),
      sb.from("bank_movements").select("id").eq("entity_id", entity).eq("reconciled_to", "unmatched"),
      rid ? sb.from("mep_dishes").select("id,is_active").eq("is_active", true) : Promise.resolve({ data: [] } as any),
      rid ? sb.from("tasks").select("id,priority,status").in("status", ["open", "in_progress"]).limit(50) : Promise.resolve({ data: [] } as any),
      sb.from("v_finance_anomalies_open").select("kind,severity,description").eq("entity_code", entity).limit(6),
      sb.from("team_invitations")
        .select("invited_email,invited_name,role,starting_date,accepted_at")
        .eq("entity_code", entity)
        .not("accepted_at", "is", null)
        .is("revoked_at", null)
        .gte("accepted_at", cutoff14)
        .order("accepted_at", { ascending: false })
        .limit(10),
      // PA integration Sprint 1 — pull top-impact open master_todos.
      sb.from("master_todos").select("title,impact_score,source,due_at,entity_code").not("status", "in", "(completed,deferred)").order("impact_score", { ascending: false }).limit(20),
      userId ? sb.from("pa_schedule_state").select("morning_brief_time,evening_debrief_time,daily_academy_time,whatsapp_triage_hourly").eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null } as any),
      // Pillars #3 — Academy progress bundle for the current pillar / module.
      // We read the module from page_context.active_pillar; if we don't know
      // it (e.g. voice input before a route change) we skip the join.
      (userId && pageContext && (pageContext.active_pillar === "foh" || pageContext.active_pillar === "boh" || pageContext.active_pillar === "office"))
        ? sb.from("academy_lessons").select("id,title,module_scope,delivered_at").contains("module_scope", [pageContext.active_pillar]).order("delivered_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] } as any),
      userId ? sb.from("academy_lesson_progress").select("lesson_id,status").eq("user_id", userId) : Promise.resolve({ data: [] } as any),
    ]);

    // Resolve per-hire step counts so "What is Alberto's onboarding status?"
    // has a real answer for the assistant to summarise.
    const invRows = ((invitations && (invitations as any).data) || []) as any[];
    const invEmails = invRows.map((i) => (i.invited_email || "").toLowerCase()).filter(Boolean);
    let onboardingInProgress: Array<{ name: string; role: string; step_count: number; started: string | null }> = [];
    if (invEmails.length) {
      const { data: profs } = await sb.from("profiles").select("id,email,name").in("email", invEmails);
      const byEmail = new Map<string, { id: string; name: string }>();
      (profs || []).forEach((pf: any) => { if (pf.email) byEmail.set(pf.email.toLowerCase(), { id: pf.id, name: pf.name }); });
      const uids = Array.from(byEmail.values()).map((v) => v.id);
      const stepCount = new Map<string, number>();
      if (uids.length) {
        const { data: steps } = await sb.from("onboarding_steps").select("user_id").in("user_id", uids).not("done_at", "is", null);
        (steps || []).forEach((r: any) => stepCount.set(r.user_id, (stepCount.get(r.user_id) || 0) + 1));
      }
      for (const inv of invRows) {
        const prof = byEmail.get((inv.invited_email || "").toLowerCase());
        if (!prof) continue;
        const sc = stepCount.get(prof.id) || 0;
        if (sc >= 8) continue;
        onboardingInProgress.push({
          name: prof.name || inv.invited_name || inv.invited_email,
          role: inv.role || "other",
          step_count: sc,
          started: inv.starting_date || inv.accepted_at || null,
        });
        if (onboardingInProgress.length >= 5) break;
      }
    }

    const covers = (bookings.data || [])
      .filter((b: any) => !["cancelled","no_show"].includes(String(b.status || "").toLowerCase()))
      .reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);
    const invopen  = invInbox.data || [];
    const invTotal = invopen.reduce((a: number, r: any) => a + Number(r.amount_eur || 0), 0);
    const bankOpen = (bank.data || []).length;
    const mepOpen  = (mep.data || []).length;
    const tasksOpen = (tasks.data || []).filter((t: any) => (t.priority || "") === "urgent" || (t.priority || "") === "high").length;

    const topTodos = ((masterTodos as any).data || [])
      .filter((t: any) => !t.entity_code || t.entity_code === entity)
      .slice(0, 5)
      .map((t: any) => ({ title: t.title, impact_score: t.impact_score, source: t.source, due_at: t.due_at }));

    const hh = Number(madridHHmm().slice(0, 2));
    const svc: AssistantContext["service_phase"] = hh < 19 ? "before" : hh < 24 ? "during" : "after";

    // Ad reactivation summary — best-effort, only surfaces when there are
    // rows in platform_reactivation_state for meta-ads. Powers Chef FAB's
    // "how's the BM ad situation" answer.
    let adReactivation: AssistantContext["ad_reactivation"] = null;
    try {
      const { data: prRows } = await sb.from("platform_reactivation_state")
        .select("step_key,done")
        .eq("entity_code", entity).eq("platform", "meta-ads");
      const steps = prRows || [];
      const REACT_KEYS = ["card_rotated","campaigns_audited","creative_refreshed","budget_set"];
      const doneKeys = new Set(steps.filter((r: any) => r.done).map((r: any) => r.step_key));
      const stepsDone = REACT_KEYS.filter((k) => doneKeys.has(k)).length;
      if (steps.length > 0 || entity === "BM") {
        adReactivation = {
          platform: "meta-ads",
          status_label: entity === "BM" ? "Disabled" : null,
          steps_done: stepsDone,
          steps_total: REACT_KEYS.length,
          ready: stepsDone === REACT_KEYS.length,
          disabled_since: entity === "BM" ? "2026-04-04" : null,
        };
      }
    } catch {}

    return {
      entity,
      today,
      now_hhmm: madridHHmm(),
      service_phase: svc,
      covers_booked: covers,
      eod_posted: !!eod.data,
      eod_revenue: eod.data ? Number((eod.data as any).revenue || 0) : null,
      open_invoices_count: invopen.length,
      open_invoices_total_eur: invTotal,
      bank_unmatched_count: bankOpen,
      active_mep_dishes: mepOpen,
      urgent_tasks_count: tasksOpen,
      low_inventory_count: 0,
      open_anomalies_count: (anomalies.data || []).length,
      onboarding_in_progress: onboardingInProgress,
      top_anomalies: (anomalies.data || []).slice(0, 3).map((a: any) => ({
        kind: String(a.kind), severity: Number(a.severity || 2), description: String(a.description || "").slice(0, 200),
      })),
      ad_reactivation: adReactivation,
      top_master_todos: topTodos,
      pa_schedule: (paSchedule as any).data || null,
      academy_progress_current_module: (() => {
        const scope = pageContext && (pageContext.active_pillar === "foh" || pageContext.active_pillar === "boh" || pageContext.active_pillar === "office") ? pageContext.active_pillar : null;
        if (!scope) return null;
        const lessons: any[] = ((academyModuleLessons as any)?.data) || [];
        const progress: any[] = ((academyProgress as any)?.data) || [];
        const byLesson = new Map<string, string>();
        for (const p of progress) byLesson.set(p.lesson_id, p.status);
        const total = lessons.length;
        const done = lessons.filter((l) => byLesson.get(l.id) === "done").length;
        const inProg = lessons.filter((l) => byLesson.get(l.id) === "in_progress").length;
        const next = lessons.find((l) => byLesson.get(l.id) !== "done");
        return {
          module_scope: scope as "foh" | "boh" | "office",
          total,
          done,
          in_progress: inProg,
          next_lesson_title: next?.title ?? null,
        };
      })(),
      page_context: pageContext,
    };
  }

  async getMemory(entity: EntityCode, userId: string | null): Promise<AssistantMemoryFact[]> {
    const sb = supabaseServer();
    const [memRes, patRes] = await Promise.all([
      userId
        ? sb.from("assistant_memory").select("fact,scope").eq("user_id", userId).is("retired_at", null).order("confirmed_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [] } as any),
      // Bank reconciliation intelligence #3 — active recurring patterns become
      // memory hints so the FAB can reason about "what does this movement look
      // like?" using institutional knowledge.
      sb.from("recurring_bank_patterns").select("label,pattern_type,expected_frequency,times_matched,bank_account").eq("entity_code", entity).is("disabled_at", null).order("times_matched", { ascending: false }).limit(15),
    ]);
    const mem: AssistantMemoryFact[] = ((memRes.data as any[]) || []).map((m: any) => ({ fact: m.fact, scope: m.scope }));
    const patternHints: AssistantMemoryFact[] = ((patRes.data as any[]) || []).map((p: any) => ({
      fact: "Recurring bank pattern (" + p.pattern_type + ", " + p.expected_frequency + ", " + Number(p.times_matched || 0) + "x): " + p.label + (p.bank_account ? " on " + p.bank_account : ""),
      scope: "bank_pattern",
    }));
    return [...mem, ...patternHints];
  }

  async getConfig(entity: EntityCode): Promise<AssistantConfig | null> {
    const sb = supabaseServer();
    const { data } = await sb.from("assistant_config").select("*").eq("entity_code", entity).maybeSingle();
    if (!data) return null;
    return {
      entity_code: entity,
      voice_profile: (data as any).voice_profile || "",
      personality_dials: (data as any).personality_dials || { formality: 0.5, warmth: 0.6, brevity: 0.6 },
      timezone: (data as any).timezone || "Europe/Madrid",
      working_hours: (data as any).working_hours || {},
      quiet_hours: (data as any).quiet_hours || { start: "23:30", end: "08:00" },
    };
  }

  async getHistory(sessionId: string | null, userId: string | null, limit = 10) {
    if (!userId) return [];
    const sb = supabaseServer();
    const q = sessionId
      ? sb.from("assistant_conversations").select("turn_role,text,created_at").eq("user_id", userId).eq("session_id", sessionId).order("created_at", { ascending: false }).limit(limit * 2)
      : sb.from("assistant_conversations").select("turn_role,text,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit * 2);
    const { data } = await q;
    return (data || []).slice().reverse()
      .filter((t: any) => t.turn_role !== "sys" && t.text)
      .map((t: any) => ({ role: t.turn_role as "user" | "assistant", text: t.text }));
  }

  async getFewShot(userId: string | null) {
    if (!userId) return [];
    const sb = supabaseServer();
    const { data } = await sb.from("assistant_intents")
      .select("text,confirmed_intent")
      .eq("user_id", userId)
      .not("confirmed_intent", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    return (data || []).map((p: any) => ({ text: p.text, intent: p.confirmed_intent }));
  }

  private buildSystem(mode: AssistantMode, input: GenerateInput): string {
    const cfg = input.config;
    const voice = cfg?.voice_profile ? "\n\nVoice:\n" + cfg.voice_profile : "";
    const dials = cfg?.personality_dials
      ? "\n\nPersonality dials (0..1 sliders):\n- formality: " + cfg.personality_dials.formality
        + "\n- warmth: " + cfg.personality_dials.warmth
        + "\n- brevity: " + cfg.personality_dials.brevity
      : "";
    const memBlock = (input.memory && input.memory.length)
      ? "\n\nMemory (treat as true unless the user updates them):\n" + input.memory.map((m, i) => (i + 1) + ". " + m.fact + (m.scope && m.scope !== "global" ? " [" + m.scope + "]" : "")).join("\n")
      : "";
    const ctx = input.context;
    const ctxBlock = ctx
      ? "\n\nOS state right now (" + ctx.entity + "):\n"
        + "- date: " + ctx.today + " " + ctx.now_hhmm + " Ibiza\n"
        + "- service: " + ctx.service_phase + "\n"
        + "- covers booked today: " + ctx.covers_booked + "\n"
        + "- EOD posted: " + (ctx.eod_posted ? "yes · €" + (ctx.eod_revenue ?? 0) : "no") + "\n"
        + "- invoices waiting: " + ctx.open_invoices_count + " (€" + Math.round(ctx.open_invoices_total_eur) + ")\n"
        + "- bank unmatched: " + ctx.bank_unmatched_count + "\n"
        + "- active MEP dishes: " + ctx.active_mep_dishes + "\n"
        + "- urgent tasks: " + ctx.urgent_tasks_count + "\n"
        + "- open finance anomalies: " + ctx.open_anomalies_count
        + (ctx.top_anomalies && ctx.top_anomalies.length
          ? "\n- top anomalies:\n" + ctx.top_anomalies.map((a: any) => "    · [S" + a.severity + "] " + a.kind + " — " + a.description).join("\n")
          : "")
        + (ctx.ad_reactivation
            ? "\n- ad reactivation (" + ctx.ad_reactivation.platform + "): "
              + (ctx.ad_reactivation.status_label ? ctx.ad_reactivation.status_label + " · " : "")
              + ctx.ad_reactivation.steps_done + "/" + ctx.ad_reactivation.steps_total + " steps "
              + (ctx.ad_reactivation.ready ? "· reactivate ready" : "· not ready")
              + (ctx.ad_reactivation.disabled_since ? " · disabled since " + ctx.ad_reactivation.disabled_since : "")
            : "")
        + (ctx.top_master_todos && ctx.top_master_todos.length
            ? "\n- highest-impact plate items:\n" + ctx.top_master_todos.map((t, i) => "  " + (i+1) + ". " + t.title + " (impact " + t.impact_score + ", " + t.source + ")").join("\n")
            : "")
        + (ctx.pa_schedule
            ? "\n- PA schedule: morning brief " + (ctx.pa_schedule.morning_brief_time || "09:00")
              + " · evening debrief " + (ctx.pa_schedule.evening_debrief_time || "21:00")
              + " · daily academy " + (ctx.pa_schedule.daily_academy_time || "08:30")
              + " · WhatsApp triage " + (ctx.pa_schedule.whatsapp_triage_hourly ? "hourly" : "off")
            : "")
        + (ctx.page_context && ctx.page_context.active_pillar ? "\n- active pillar: " + ctx.page_context.active_pillar + " (FOH=service, BOH=kitchen, Office=books)" : "")
        + (ctx.academy_progress_current_module ? "\n- academy (" + ctx.academy_progress_current_module.module_scope + "): " + ctx.academy_progress_current_module.done + "/" + ctx.academy_progress_current_module.total + " done" + (ctx.academy_progress_current_module.next_lesson_title ? " · next: " + ctx.academy_progress_current_module.next_lesson_title : "") : "")
        + (ctx.page_context ? "\n- current page context: " + JSON.stringify(ctx.page_context).slice(0, 1500) : "")
      : "";
    const extra = input.system_extra ? "\n\n" + input.system_extra : "";
    // PA Sprint 2 — the charter binds a sub-agent to its scope.
    const ch = input.charter;
    const charterBlock = ch
      ? "\n\nAgent Task Charter (this is your contract — do not exceed scope):\n"
        + "- type: " + ch.agent_type + "\n"
        + "- objective: " + ch.objective + "\n"
        + (ch.scope ? "- scope: " + ch.scope + "\n" : "")
        + (ch.constraints ? "- constraints: " + ch.constraints + "\n" : "")
        + (ch.success_criteria ? "- success criteria: " + ch.success_criteria + "\n" : "")
        + (ch.deliverables && ch.deliverables.length
            ? "- deliverables: " + ch.deliverables.map((d: any) => typeof d === "string" ? d : d?.description || JSON.stringify(d)).join("; ")
            : "")
      : "";

    if (mode === "chat")    return CHAT_BASE    + voice + dials + memBlock + ctxBlock + charterBlock + extra;
    if (mode === "brief")   return BRIEF_BASE   + voice + dials + memBlock + ctxBlock + charterBlock + extra;
    if (mode === "extract") return EXTRACT_BASE + extra;
    return DRAFT_BASE + voice + dials + memBlock + ctxBlock + charterBlock + extra;
  }

  private modelFor(mode: AssistantMode) {
    if (mode === "chat")  return CHAT_MODEL;
    if (mode === "brief") return BRIEF_MODEL;
    if (mode === "extract") return EXTRACT_MODEL;
    return DRAFT_MODEL;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const key = process.env.ANTHROPIC_API_KEY;
    const model = this.modelFor(input.mode);
    if (!key) return { ok: false, text: "Assistant isn't switched on yet (needs ANTHROPIC_API_KEY).", intent: null, confidence: 0, actions: [], raw_json: null, cost_usd: null, cost_eur: null, input_tokens: null, output_tokens: null, latency_ms: 0, model };

    const system = this.buildSystem(input.mode, input);
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    if (input.history) messages.push(...input.history.map((t) => ({ role: t.role, content: t.text })));
    messages.push({ role: "user" as const, content: input.prompt });

    const t0 = Date.now();
    let text = "";
    let usage: any = null;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: input.mode === "brief" ? 1200 : 900, system, messages }),
      });
      const data = await r.json();
      text = data?.content?.[0]?.text || data?.error?.message || "";
      usage = data?.usage || null;
    } catch (e: any) {
      return { ok: false, text: "Assistant error: " + (e?.message || "unknown"), intent: null, confidence: 0, actions: [], raw_json: null, cost_usd: null, cost_eur: null, input_tokens: null, output_tokens: null, latency_ms: Date.now() - t0, model };
    }
    const latency = Date.now() - t0;

    let rawJson: any = null;
    let intent: string | null = null;
    let confidence: number | null = null;
    const actions: any[] = [];
    if (input.mode === "chat") {
      const m = text.match(/<assistant>([\s\S]*?)<\/assistant>/) || text.match(/<chef>([\s\S]*?)<\/chef>/);
      if (m) {
        try { rawJson = JSON.parse(m[1]); } catch {}
        text = text.replace(m[0], "").trim();
        if (rawJson) {
          intent = rawJson.intent ?? null;
          confidence = typeof rawJson.confidence === "number" ? rawJson.confidence : null;
          if (rawJson.order)    actions.push({ type: "order",    data: rawJson.order });
          if (rawJson.feedback) actions.push({ type: "feedback", data: rawJson.feedback });
          if (rawJson.memory)   actions.push({ type: "memory",   data: rawJson.memory });
        }
      }
    }

    let cost: number | null = null;
    let costEur: number | null = null;
    let inTok: number | null = null;
    let outTok: number | null = null;
    if (usage) {
      inTok  = Number(usage.input_tokens  || 0);
      outTok = Number(usage.output_tokens || 0);
      cost    = (inTok / 1_000_000) * PRICE_IN_PER_MTOK     + (outTok / 1_000_000) * PRICE_OUT_PER_MTOK;
      costEur = (inTok / 1_000_000) * PRICE_IN_PER_MTOK_EUR + (outTok / 1_000_000) * PRICE_OUT_PER_MTOK_EUR;
    }

    return {
      ok: true, text, intent, confidence, actions, raw_json: rawJson,
      cost_usd: cost, cost_eur: costEur,
      input_tokens: inTok, output_tokens: outTok,
      latency_ms: latency, model,
    };
  }

  // Read the entity's billing tier and month-to-date usage. Returns the
  // cap state so callers can refuse to generate when a cap is exceeded.
  async getBillingCap(entity: EntityCode | string): Promise<BillingCap | null> {
    const sb = supabaseServer();
    const { data: cfg } = await sb.from("assistant_config")
      .select("billing_tier").eq("entity_code", entity).maybeSingle();
    const tierName = ((cfg as any)?.billing_tier as string) || "pro";
    const { data: tier } = await sb.from("assistant_billing_tiers")
      .select("monthly_action_cap,monthly_cost_cap_eur").eq("name", tierName).maybeSingle();
    if (!tier) return null;
    const { data: mtd } = await sb.from("v_assistant_entity_mtd")
      .select("actions,cost_eur").eq("entity_code", entity).maybeSingle();
    const actionsUsed = Number((mtd as any)?.actions || 0);
    const costUsed    = Number((mtd as any)?.cost_eur || 0);
    const actionsCap  = Number((tier as any).monthly_action_cap);
    const costCap     = Number((tier as any).monthly_cost_cap_eur);
    return {
      tier: tierName,
      actions_used: actionsUsed,
      actions_cap:  actionsCap,
      cost_used_eur: costUsed,
      cost_cap_eur:  costCap,
      exceeded: actionsUsed >= actionsCap || costUsed >= costCap,
    };
  }

  async logInteraction(opts: {
    userId: string;
    entity: EntityCode;
    route?: string | null;
    sessionId?: string | null;
    userPrompt: string;
    result: GenerateOutput;
    mode: AssistantMode;
  }) {
    const sb = supabaseServer();
    const userTurn = await sb.from("assistant_conversations").insert({
      user_id: opts.userId, entity_id: opts.entity, route: opts.route || null, session_id: opts.sessionId || null,
      turn_role: "user", text: opts.userPrompt,
    }).select("id").maybeSingle();
    await sb.from("assistant_conversations").insert({
      user_id: opts.userId, entity_id: opts.entity, route: opts.route || null, session_id: opts.sessionId || null,
      turn_role: "assistant", text: opts.result.text, intent: opts.result.intent, confidence: opts.result.confidence,
    });
    await sb.from("assistant_actions").insert({
      user_id: opts.userId,
      conversation_id: userTurn.data?.id || null,
      action_type: "generate",
      action_kind: opts.mode,
      entity_code: opts.entity,
      target_table: "assistant_conversations",
      cost_eur: opts.result.cost_eur,
      latency_ms: opts.result.latency_ms,
      model: opts.result.model,
      input_tokens:  opts.result.input_tokens,
      output_tokens: opts.result.output_tokens,
      payload: {
        mode: opts.mode, model: opts.result.model,
        latency_ms: opts.result.latency_ms,
        cost_usd: opts.result.cost_usd, cost_eur: opts.result.cost_eur,
        entity: opts.entity,
      },
      reversible: false,
    });
    return { user_turn_id: userTurn.data?.id as string | undefined };
  }

  // Metering-only insert for non-chat action kinds (send, webhook_receive,
  // triage) that don't have a matching conversation row. Called by the
  // webhook receivers and the send edges.
  async logAction(opts: {
    userId?: string | null;
    entity: EntityCode | string;
    kind: "chat" | "brief" | "draft" | "triage" | "send" | "webhook_receive";
    route?: string | null;
    payload?: any;
    result?: Partial<GenerateOutput> | null;
  }) {
    const sb = supabaseServer();
    await sb.from("assistant_actions").insert({
      user_id: opts.userId || null,
      action_type: opts.kind === "webhook_receive" ? "webhook" : "generate",
      action_kind: opts.kind,
      entity_code: opts.entity,
      target_table: opts.route || null,
      cost_eur: opts.result?.cost_eur ?? 0,
      latency_ms: opts.result?.latency_ms ?? null,
      model: opts.result?.model || null,
      input_tokens:  opts.result?.input_tokens  ?? null,
      output_tokens: opts.result?.output_tokens ?? null,
      payload: opts.payload || {},
      reversible: false,
    });
  }
}

const CHAT_BASE = `You are the Food Studios Assistant — the operator's second brain inside a restaurant OS. People talk to you like Siri; you reply like a seasoned head chef who also knows the numbers and the calendar. You can:
- answer recipe / cooking / pairing / cost questions;
- help run the day (prep, deliveries, HACCP, EOD);
- triage OS feedback + draft purchase orders;
- read the current page context and reference it when relevant.

Rules for every turn:
- FIRST decide intent + confidence (0..1). Intents: ask | order | feedback | capture | memory.
- If confidence < 0.75 the UI will ask the user to confirm — that's fine.
- Match the user's language (English or Spanish).
- Never send/purchase/post anything yourself — you draft, a human confirms.
- Speak in the entity's voice (see Voice below). Respect the dials.

End every reply with EXACTLY this tail on its own line:
<assistant>{"intent":"ask|order|feedback|capture|memory","confidence":0.0-1.0,"order":[{"name":"...","qty":1,"unit":"kg"}]|null,"feedback":{"kind":"love|idea|bug|confusing","body":"..."}|null,"memory":{"fact":"...","scope":"global|entity:IFL|topic:finance"}|null,"did_action":null}</assistant>`;

const BRIEF_BASE = `You write the operator's morning brief — 4 to 6 short paragraphs of editorial prose. Not bullets. Not a dashboard. A brief the operator reads once with coffee and knows what today needs.

Cover, in order:
1. The shape of the day — covers, service window, anything unusual.
2. What matters in the kitchen — MEP, deliveries, prep debt.
3. What matters in the office — invoices waiting, bank movements to reconcile, cash.
4. One or two things to lift the day — a suggestion, a small nudge, a compliment when the numbers deserve it.

Tone: serif prose. Warm. Short sentences. No exclamation marks. No emojis. No lists. Speak in the entity's voice. Never make up numbers — only use what's in the OS state block.`;

const DRAFT_BASE = `You draft outbound messages on the operator's behalf — supplier emails, guest replies, WhatsApp to the team. You never send. You produce a draft the operator can copy or send-with-one-tap.

Rules:
- Match the entity's voice exactly.
- Keep it short — the reader is running a restaurant.
- Never invent numbers or facts not in the OS state block.
- Sign off with the operator's first name (given in the prompt) or leave it unsigned.`;

const EXTRACT_BASE = `You are an extraction agent. Given a short piece of input (typically an email or a document snippet), you return STRICT JSON matching the schema in the user prompt. No prose, no code fences, no commentary. If the input does not match the shape being asked about, return the JSON with null / false fields — never invent.`;

export const orchestrator = new AssistantOrchestrator();
