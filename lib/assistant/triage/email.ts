// Assistant Sprint 3 · #2 — Email triage + draft pipeline.
//
// The pipeline is thin on purpose:
//   1. triageInbox — pull recent Gmail threads via the channel adapter, ask
//      the orchestrator to categorise + prioritise them against the entity's
//      playbooks. Returns a small, JSON-shaped verdict per thread.
//   2. draftReply — pull the full thread body, ask the orchestrator to draft
//      the reply in the entity's voice, and create a Gmail draft. Nothing
//      is ever sent from here — send is a separate, gated action.
//
// Both functions log to assistant_actions so every triage / draft is
// reversible (delete the draft) and auditable (who, when, why).
//
// The prompts are compact — the orchestrator's system prompt already carries
// voice + personality dials + OS context. We just tell it what shape to
// return.

import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";
import {
  listRecentThreads,
  getThread,
  createDraft,
  sendDraft,
  type GmailThreadSummary,
} from "@/lib/assistant/channels/gmail";
import type { AssistantChannelRow, AssistantPlaybookRow } from "@/types/db";

export type TriageVerdict = {
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  last_message_at: string;
  unread: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  category: string;
  reason: string;
  suggested_action: "draft_reply" | "flag" | "snooze" | "archive" | "no_action";
  playbook_hit?: string | null;
};

// Playbook priority order for the assistant. This mirrors the brief in words
// the orchestrator can follow. Playbooks from the DB come first (per entity).
const PRIORITY_LADDER = [
  { rank: 1, tag: "bookings/revenue",  hint: "guest reservations, private-dining requests, deposits, payments" },
  { rank: 2, tag: "suppliers/ops",     hint: "supplier invoices, deliveries, staff on shift, maintenance" },
  { rank: 3, tag: "projects",          hint: "long-running work, decks, contracts, non-urgent partners" },
  { rank: 4, tag: "personal",          hint: "friends, family, personal admin" },
  { rank: 5, tag: "other",             hint: "newsletters, receipts, everything else" },
];

async function loadPlaybooks(entity: EntityCode): Promise<AssistantPlaybookRow[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_playbooks")
    .select("*")
    .eq("entity_code", entity)
    .order("priority", { ascending: true });
  return (data || []) as AssistantPlaybookRow[];
}

function summarisePlaybooks(pbs: AssistantPlaybookRow[]): string {
  if (!pbs.length) return "No entity-specific playbooks configured yet.";
  return pbs.slice(0, 8).map((p, i) => {
    const rules = Array.isArray(p.triage_rules) ? p.triage_rules.slice(0, 3) : [];
    const bits = rules.map((r) => JSON.stringify(r)).join(" | ");
    return `${i + 1}. ${p.name} (priority ${p.priority}) — ${p.description || "—"}${bits ? " · " + bits : ""}`;
  }).join("\n");
}

function summariseThreads(threads: GmailThreadSummary[]): string {
  return threads.slice(0, 25).map((t, i) => {
    return `[T${i + 1}] id=${t.thread_id} from=${t.from} subject="${t.subject}" unread=${t.unread ? "yes" : "no"} at=${t.last_message_at}\nsnippet: ${t.snippet.slice(0, 240)}`;
  }).join("\n\n");
}

const TRIAGE_SYSTEM_HINT = `You are triaging an operator's Gmail inbox for a restaurant business. Classify each thread by priority (1 = urgent, 5 = ignore) and category, using the priority ladder + entity playbooks provided. Return STRICT JSON only — no prose, no code fences.`;

// --------------------------------------------------------------------------
// triageInbox — pull recent threads + ask the orchestrator to categorise.
// --------------------------------------------------------------------------

export type TriageOptions = {
  entity: EntityCode;
  userId: string;
  since?: Date;
};

export async function triageInbox(channel: AssistantChannelRow, opts: TriageOptions): Promise<TriageVerdict[]> {
  const since = opts.since || new Date(Date.now() - 24 * 3600 * 1000);
  const threads = await listRecentThreads(channel, since);
  if (!threads.length) return [];

  const playbooks = await loadPlaybooks(opts.entity);
  const ladder = PRIORITY_LADDER.map((r) => `${r.rank}. ${r.tag} — ${r.hint}`).join("\n");
  const playbookBlock = summarisePlaybooks(playbooks);
  const threadBlock = summariseThreads(threads);

  const prompt =
`Priority ladder (lower rank = higher priority):
${ladder}

Entity playbooks (${opts.entity}, priority-ordered):
${playbookBlock}

Threads to triage:
${threadBlock}

Return JSON matching this schema:
{ "verdicts": [ { "thread_id": string, "priority": 1|2|3|4|5, "category": string, "reason": string, "suggested_action": "draft_reply"|"flag"|"snooze"|"archive"|"no_action", "playbook_hit": string|null } ] }
Only include threads that need attention. Skip newsletters and receipts that don't need a reply.`;

  const context = await orchestrator.getContext(opts.entity, opts.userId, { kind: "email_triage", channel_id: channel.id, thread_count: threads.length });
  const config = await orchestrator.getConfig(opts.entity);
  const result = await orchestrator.generate({
    context, config, prompt, mode: "draft",
    system_extra: TRIAGE_SYSTEM_HINT,
  });

  // Log the triage run so it's auditable.
  const sb = supabaseServer();
  await sb.from("assistant_actions").insert({
    user_id: opts.userId,
    action_type: "email.triage",
    target_table: "assistant_channels",
    target_id: channel.id,
    payload: {
      entity: opts.entity,
      channel_id: channel.id,
      threads_seen: threads.length,
      since: since.toISOString(),
      cost_usd: result.cost_usd,
      latency_ms: result.latency_ms,
      model: result.model,
    },
    reversible: false,
  });

  // Parse the orchestrator's JSON output. Be tolerant — pull the first {...}
  // block if there's chatter around it.
  let parsed: any = null;
  const m = result.text.match(/\{[\s\S]*\}/);
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
  }
  const raw = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];

  const byId = new Map(threads.map((t) => [t.thread_id, t] as const));
  const verdicts: TriageVerdict[] = raw.map((v: any) => {
    const t = byId.get(String(v.thread_id));
    const priority = clampPriority(v.priority);
    return {
      thread_id: String(v.thread_id),
      from: t?.from || "",
      subject: t?.subject || "",
      snippet: t?.snippet || "",
      last_message_at: t?.last_message_at || new Date().toISOString(),
      unread: !!t?.unread,
      priority,
      category: String(v.category || "other"),
      reason: String(v.reason || "").slice(0, 400),
      suggested_action: normaliseAction(String(v.suggested_action || "no_action")),
      playbook_hit: v.playbook_hit ? String(v.playbook_hit).slice(0, 120) : null,
    };
  }).filter((v: TriageVerdict) => byId.has(v.thread_id));

  // Fallback: if the model didn't return anything usable, hand back a neutral
  // rank-3 verdict for each thread so the UI still has rows to render.
  if (!verdicts.length) {
    return threads.map((t) => ({
      thread_id: t.thread_id, from: t.from, subject: t.subject, snippet: t.snippet,
      last_message_at: t.last_message_at, unread: t.unread,
      priority: 3, category: "unclassified", reason: "triage model returned no verdicts",
      suggested_action: "flag" as const, playbook_hit: null,
    }));
  }

  return verdicts.sort((a, b) => a.priority - b.priority);
}

function clampPriority(v: any): 1 | 2 | 3 | 4 | 5 {
  const n = Number(v);
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 3;
}

function normaliseAction(v: string): TriageVerdict["suggested_action"] {
  const a = v.toLowerCase();
  if (a === "draft_reply" || a === "flag" || a === "snooze" || a === "archive" || a === "no_action") return a;
  if (a.includes("draft")) return "draft_reply";
  if (a.includes("archive")) return "archive";
  if (a.includes("snooze")) return "snooze";
  return "flag";
}

// --------------------------------------------------------------------------
// draftReply — full thread → orchestrator draft → Gmail draft.
// --------------------------------------------------------------------------

const DRAFT_SYSTEM_HINT = `You are writing a concise, on-brand reply to an email thread on the operator's behalf. Output STRICT JSON only — no prose, no code fences. Match the entity's voice. Keep it short. Never invent facts. If the user hasn't asked you to send a specific thing, propose a reasonable next step.`;

export type DraftReplyResult = {
  draft_id: string;
  message_id: string;
  subject: string;
  to: string;
  body: string;
  in_reply_to: string | null;
  thread_id: string;
  cost_usd: number | null;
  latency_ms: number;
};

export async function draftReply(channel: AssistantChannelRow, opts: {
  entity: EntityCode;
  userId: string;
  thread_id: string;
  instructions?: string | null;
}): Promise<DraftReplyResult> {
  const thread = await getThread(channel, opts.thread_id);
  const messages = thread.messages || [];
  const last = messages[messages.length - 1];
  if (!last) throw new Error("thread has no messages");

  const to = last.from; // Reply to whoever sent the most recent inbound.
  const replySubject = /^re:\s/i.test(last.subject) ? last.subject : `Re: ${last.subject || thread.subject}`;
  const in_reply_to = last.message_id_header || null;

  const playbooks = await loadPlaybooks(opts.entity);
  const playbookBlock = summarisePlaybooks(playbooks);
  const transcript = messages.slice(-6).map((m, i) => `--- Message ${i + 1} (${m.from} · ${m.received_at}) ---\n${m.body_text.slice(0, 2000)}`).join("\n\n");

  const prompt =
`Entity: ${opts.entity}
Reply-to: ${to}
Subject: ${replySubject}
${opts.instructions ? `Operator instructions: ${opts.instructions}\n` : ""}

Playbooks (${opts.entity}):
${playbookBlock}

Recent thread transcript (oldest → newest):
${transcript}

Return JSON:
{ "subject": "Re: ...", "body": "…plain text reply, no HTML…" }
Voice must match the Voice block. No exclamation marks. No emojis. Keep under 180 words unless the operator asked for more.`;

  const context = await orchestrator.getContext(opts.entity, opts.userId, { kind: "email_draft", channel_id: channel.id, thread_id: opts.thread_id });
  const config = await orchestrator.getConfig(opts.entity);
  const result = await orchestrator.generate({
    context, config, prompt, mode: "draft",
    system_extra: DRAFT_SYSTEM_HINT,
  });

  let parsed: any = null;
  const m = result.text.match(/\{[\s\S]*\}/);
  if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  const subject = String(parsed?.subject || replySubject);
  const body = String(parsed?.body || result.text || "").trim();
  if (!body) throw new Error("orchestrator returned an empty draft body");

  const draft = await createDraft(channel, {
    to,
    subject,
    body,
    in_reply_to,
    references: in_reply_to,
    thread_id: opts.thread_id,
  });

  const sb = supabaseServer();
  await sb.from("assistant_actions").insert({
    user_id: opts.userId,
    action_type: "email.draft",
    target_table: "assistant_channels",
    target_id: channel.id,
    payload: {
      entity: opts.entity,
      channel_id: channel.id,
      thread_id: opts.thread_id,
      draft_id: draft.draft_id,
      message_id: draft.message_id,
      to,
      subject,
      body_preview: body.slice(0, 400),
      cost_usd: result.cost_usd,
      latency_ms: result.latency_ms,
      model: result.model,
    },
    reversible: true,
  });

  return {
    draft_id: draft.draft_id,
    message_id: draft.message_id,
    subject,
    to,
    body,
    in_reply_to,
    thread_id: opts.thread_id,
    cost_usd: result.cost_usd,
    latency_ms: result.latency_ms,
  };
}

// --------------------------------------------------------------------------
// sendDraftFor — a thin logging wrapper over the Gmail adapter's sendDraft.
// --------------------------------------------------------------------------

export async function sendDraftFor(channel: AssistantChannelRow, opts: { userId: string; entity: EntityCode; draft_id: string }): Promise<{ sent_id: string }> {
  const out = await sendDraft(channel, opts.draft_id);
  const sb = supabaseServer();
  await sb.from("assistant_actions").insert({
    user_id: opts.userId,
    action_type: "email.send",
    target_table: "assistant_channels",
    target_id: channel.id,
    payload: {
      entity: opts.entity,
      channel_id: channel.id,
      draft_id: opts.draft_id,
      sent_id: out.sent_id,
    },
    reversible: false, // once sent, can't be reversed here
  });
  return out;
}
