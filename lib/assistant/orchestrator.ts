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
export type AssistantMode = "chat" | "brief" | "draft";

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
};

export type GenerateOutput = {
  ok: boolean;
  text: string;
  intent: string | null;
  confidence: number | null;
  actions: any[];
  raw_json: any | null;
  cost_usd: number | null;
  latency_ms: number;
  model: string;
};

const CHAT_MODEL   = "claude-haiku-4-5-20251001";
const BRIEF_MODEL  = "claude-haiku-4-5-20251001";
const DRAFT_MODEL  = "claude-haiku-4-5-20251001";

const PRICE_IN_PER_MTOK  = 1.0;
const PRICE_OUT_PER_MTOK = 5.0;

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
  async getContext(entity: EntityCode, _userId: string | null, pageContext: any | null): Promise<AssistantContext> {
    const sb = supabaseServer();
    const today = madridToday();
    const rid = ENTITY_TO_RID[entity] || null;

    const [eod, bookings, invInbox, bank, mep, tasks] = await Promise.all([
      rid ? sb.from("eod_accounting").select("revenue,actual_covers").eq("restaurant_id", rid).eq("report_date", today).maybeSingle() : Promise.resolve({ data: null } as any),
      rid ? sb.from("bookings").select("party_size,status").eq("restaurant_id", rid).eq("service_date", today) : Promise.resolve({ data: [] } as any),
      sb.from("invoice_inbox").select("amount_eur,match_status").eq("entity_id", entity).not("match_status", "in", "(approved,rejected,duplicate)"),
      sb.from("bank_movements").select("id").eq("entity_id", entity).eq("reconciled_to", "unmatched"),
      rid ? sb.from("mep_dishes").select("id,is_active").eq("is_active", true) : Promise.resolve({ data: [] } as any),
      rid ? sb.from("tasks").select("id,priority,status").in("status", ["open", "in_progress"]).limit(50) : Promise.resolve({ data: [] } as any),
    ]);

    const covers = (bookings.data || [])
      .filter((b: any) => !["cancelled","no_show"].includes(String(b.status || "").toLowerCase()))
      .reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);
    const invopen  = invInbox.data || [];
    const invTotal = invopen.reduce((a: number, r: any) => a + Number(r.amount_eur || 0), 0);
    const bankOpen = (bank.data || []).length;
    const mepOpen  = (mep.data || []).length;
    const tasksOpen = (tasks.data || []).filter((t: any) => (t.priority || "") === "urgent" || (t.priority || "") === "high").length;

    const hh = Number(madridHHmm().slice(0, 2));
    const svc: AssistantContext["service_phase"] = hh < 19 ? "before" : hh < 24 ? "during" : "after";

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
      page_context: pageContext,
    };
  }

  async getMemory(_entity: EntityCode, userId: string | null): Promise<AssistantMemoryFact[]> {
    if (!userId) return [];
    const sb = supabaseServer();
    const { data } = await sb.from("assistant_memory")
      .select("fact,scope")
      .eq("user_id", userId)
      .is("retired_at", null)
      .order("confirmed_at", { ascending: false })
      .limit(20);
    return (data || []).map((m: any) => ({ fact: m.fact, scope: m.scope }));
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
        + "- urgent tasks: " + ctx.urgent_tasks_count
        + (ctx.page_context ? "\n- current page context: " + JSON.stringify(ctx.page_context).slice(0, 1500) : "")
      : "";
    const extra = input.system_extra ? "\n\n" + input.system_extra : "";

    if (mode === "chat")  return CHAT_BASE  + voice + dials + memBlock + ctxBlock + extra;
    if (mode === "brief") return BRIEF_BASE + voice + dials + memBlock + ctxBlock + extra;
    return DRAFT_BASE + voice + dials + memBlock + ctxBlock + extra;
  }

  private modelFor(mode: AssistantMode) {
    if (mode === "chat")  return CHAT_MODEL;
    if (mode === "brief") return BRIEF_MODEL;
    return DRAFT_MODEL;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const key = process.env.ANTHROPIC_API_KEY;
    const model = this.modelFor(input.mode);
    if (!key) return { ok: false, text: "Assistant isn't switched on yet (needs ANTHROPIC_API_KEY).", intent: null, confidence: 0, actions: [], raw_json: null, cost_usd: null, latency_ms: 0, model };

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
      return { ok: false, text: "Assistant error: " + (e?.message || "unknown"), intent: null, confidence: 0, actions: [], raw_json: null, cost_usd: null, latency_ms: Date.now() - t0, model };
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
    if (usage) {
      const it = Number(usage.input_tokens || 0);
      const ot = Number(usage.output_tokens || 0);
      cost = (it / 1_000_000) * PRICE_IN_PER_MTOK + (ot / 1_000_000) * PRICE_OUT_PER_MTOK;
    }

    return { ok: true, text, intent, confidence, actions, raw_json: rawJson, cost_usd: cost, latency_ms: latency, model };
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
      target_table: "assistant_conversations",
      payload: { mode: opts.mode, model: opts.result.model, latency_ms: opts.result.latency_ms, cost_usd: opts.result.cost_usd, entity: opts.entity },
      reversible: false,
    });
    return { user_turn_id: userTurn.data?.id as string | undefined };
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

export const orchestrator = new AssistantOrchestrator();
