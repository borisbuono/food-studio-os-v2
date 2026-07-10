// Assistant Polish #1 — memory extractor.
//
// After a chat session ends the OS quietly asks Haiku 4.5 to distil the
// conversation into a short list of atomic facts worth remembering.
// Rules the prompt enforces:
//   - one fact per JSON row, present tense, factual (not opinion)
//   - only person / place / thing / preference / allergy / relationship / reminder / birthday / upcoming
//   - ignore small talk, greetings, task instructions
//   - subject-predicate-object shape + a confidence 0..1
//
// Everything cheap. Haiku is the model. The extractor is rate-limited
// per session (skips if a run happened in the last 5 minutes and short
// -circuits if the session has fewer than 2 real turns). Dedup is on
// (user_id, entity_code, subject, predicate) — an existing row wins.
// Only facts with confidence >= 0.75 are inserted.
//
// Every extraction — successful or empty — writes:
//   - a row into assistant_memory_extractions (the run log)
//   - a row into assistant_actions with action_kind='memory_extract'
//     so the cost lands on the entity's billing meter.

import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/assistant/orchestrator";

// Haiku 4.5 pricing, mirrored from the orchestrator so this file stays
// standalone and cheap to reason about.
const EXTRACTOR_MODEL          = "claude-haiku-4-5-20251001";
const PRICE_IN_PER_MTOK_USD    = 0.80;
const PRICE_OUT_PER_MTOK_USD   = 4.00;
const USD_EUR_RATE             = 0.92;
const PRICE_IN_PER_MTOK_EUR    = PRICE_IN_PER_MTOK_USD  * USD_EUR_RATE;
const PRICE_OUT_PER_MTOK_EUR   = PRICE_OUT_PER_MTOK_USD * USD_EUR_RATE;

// Rate-limit — a session isn't re-distilled more often than this.
const MIN_EXTRACT_INTERVAL_MS  = 5 * 60 * 1000;
// Minimum real conversation before there's something to learn from.
const MIN_TURNS_TO_EXTRACT     = 2;
// Confidence threshold for inserting a fact.
const DEFAULT_MIN_CONFIDENCE   = 0.75;
// Cap on transcript we send to the model (keeps cost bounded on long sessions).
const MAX_TRANSCRIPT_CHARS     = 6000;

export type ExtractedFact = {
  subject: string;
  predicate: string;
  object: string;
  kind: string;
  confidence: number;
  tags?: string[];
};

export type ExtractorResult = {
  ok: boolean;
  session_id: string;
  reason?: "no_turns" | "throttled" | "no_facts" | "error";
  facts: ExtractedFact[];
  inserted: number;
  skipped_duplicate: number;
  skipped_low_confidence: number;
  cost_eur: number | null;
  latency_ms: number;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  error?: string | null;
};

const EXTRACT_SYSTEM = `You extract atomic facts from a short chat between an operator and their restaurant assistant.

Rules:
- One fact per row.
- Present tense. Factual — no opinions, no summaries, no small talk.
- Categories allowed: person, place, thing, preference, allergy, relationship, reminder, birthday, upcoming.
- Skip greetings, chitchat, task instructions, transient state ("cook this now").
- Facts must be true across future sessions, not this session only.
- Confidence 0..1 — how sure you are the operator would confirm this if asked.

Return STRICT JSON only. No prose. No code fences.
Schema:
{ "facts": [ { "subject": string, "predicate": string, "object": string, "kind": "person|place|thing|preference|allergy|relationship|reminder|birthday|upcoming", "confidence": number, "tags": string[] } ] }

If there is nothing worth remembering, return { "facts": [] }.`;

// Load the last N turns for a session, sorted oldest first.
async function loadSessionTurns(sessionId: string, userId: string) {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_conversations")
    .select("turn_role,text,created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(40);
  return (data || []).filter((t: any) => t.turn_role !== "sys" && t.text);
}

function transcript(turns: { turn_role: string; text: string }[]): string {
  const out: string[] = [];
  let running = 0;
  for (const t of turns) {
    const line = (t.turn_role === "user" ? "OPERATOR: " : "ASSISTANT: ") + String(t.text || "").trim();
    if (running + line.length > MAX_TRANSCRIPT_CHARS) break;
    out.push(line);
    running += line.length + 1;
  }
  return out.join("\n");
}

function factSentence(f: ExtractedFact): string {
  const bits = [f.subject, f.predicate, f.object].filter(Boolean).map((s) => String(s).trim());
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

function normaliseKey(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Dedup against existing memory: match on (user_id, entity_code, subject, predicate)
// after normalisation. Retired rows don't count.
async function findExistingFact(userId: string, entity: string, f: ExtractedFact): Promise<boolean> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_memory")
    .select("id,subject,predicate,object,fact")
    .eq("user_id", userId)
    .is("retired_at", null);
  const subKey = normaliseKey(f.subject);
  const predKey = normaliseKey(f.predicate);
  const objKey = normaliseKey(f.object);
  const factKey = normaliseKey(factSentence(f));
  for (const r of (data || []) as any[]) {
    // Only dedup within the same entity scope (or global rows with no entity).
    if (r.entity_code && r.entity_code !== entity) continue;
    if (normaliseKey(r.subject || "") === subKey && normaliseKey(r.predicate || "") === predKey) return true;
    // Fallback — same fact sentence.
    if (factKey && normaliseKey(r.fact || "") === factKey) return true;
    if (subKey && objKey && normaliseKey(r.subject || "") === subKey && normaliseKey(r.object || "") === objKey) return true;
  }
  return false;
}

async function recentlyExtracted(sessionId: string): Promise<boolean> {
  const sb = supabaseServer();
  const cutoff = new Date(Date.now() - MIN_EXTRACT_INTERVAL_MS).toISOString();
  const { data } = await sb.from("assistant_memory_extractions")
    .select("id")
    .eq("session_id", sessionId)
    .gte("created_at", cutoff)
    .limit(1);
  return (data || []).length > 0;
}

async function callHaiku(system: string, prompt: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: "", usage: null, error: "no_key" as const };
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: EXTRACTOR_MODEL,
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text || "";
    return { text, usage: data?.usage || null, error: null as string | null, latency_ms: Date.now() - t0 };
  } catch (e: any) {
    return { text: "", usage: null, error: String(e?.message || e), latency_ms: Date.now() - t0 };
  }
}

function safeParseFacts(text: string): ExtractedFact[] {
  if (!text) return [];
  // Strip fences if the model leaks any.
  const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const j = JSON.parse(clean);
    const arr = Array.isArray(j?.facts) ? j.facts : [];
    const out: ExtractedFact[] = [];
    for (const f of arr) {
      const subject   = String(f?.subject   || "").trim();
      const predicate = String(f?.predicate || "").trim();
      const object    = String(f?.object    || "").trim();
      const kind      = String(f?.kind      || "other").trim();
      const conf      = Number(f?.confidence);
      if (!subject || !predicate) continue;
      const tags = Array.isArray(f?.tags) ? f.tags.map((t: any) => String(t).slice(0, 40)).filter(Boolean).slice(0, 6) : [];
      out.push({
        subject: subject.slice(0, 200),
        predicate: predicate.slice(0, 200),
        object: object.slice(0, 500),
        kind: ["person","place","thing","preference","allergy","relationship","reminder","birthday","upcoming"].includes(kind) ? kind : "other",
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
        tags,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type ExtractOpts = {
  session_id: string;
  user_id: string;
  entity: EntityCode | string;
  min_confidence?: number;
};

// The core function. Reads a completed conversation (all turns matching
// session_id + user_id), asks Haiku to distil facts, dedupes against
// existing memory, inserts the survivors. Idempotent — calling twice in
// quick succession short-circuits the second call.
export async function extractFactsFromConversation(opts: ExtractOpts): Promise<ExtractorResult> {
  const sb = supabaseServer();
  const model = EXTRACTOR_MODEL;
  const minConf = typeof opts.min_confidence === "number" ? opts.min_confidence : DEFAULT_MIN_CONFIDENCE;

  const empty: ExtractorResult = {
    ok: true, session_id: opts.session_id, facts: [], inserted: 0,
    skipped_duplicate: 0, skipped_low_confidence: 0,
    cost_eur: null, latency_ms: 0, model,
    input_tokens: null, output_tokens: null, error: null,
  };

  if (await recentlyExtracted(opts.session_id)) {
    return { ...empty, reason: "throttled" };
  }

  const turns = await loadSessionTurns(opts.session_id, opts.user_id);
  const realTurns = turns.filter((t: any) => t.turn_role === "user" || t.turn_role === "assistant");
  const userTurns = realTurns.filter((t: any) => t.turn_role === "user").length;
  if (userTurns < MIN_TURNS_TO_EXTRACT) {
    await logRun(opts, model, { turn_count: realTurns.length, facts_extracted: 0, facts_inserted: 0, cost_eur: 0, latency_ms: 0, input_tokens: 0, output_tokens: 0, error: null });
    return { ...empty, reason: "no_turns" };
  }

  const prompt = "Transcript below. Distil into atomic facts per the rules.\n\n" + transcript(realTurns as any);
  const call = await callHaiku(EXTRACT_SYSTEM, prompt);
  const latency = (call as any).latency_ms || 0;

  if (call.error) {
    await logRun(opts, model, { turn_count: realTurns.length, facts_extracted: 0, facts_inserted: 0, cost_eur: 0, latency_ms: latency, input_tokens: 0, output_tokens: 0, error: call.error });
    return { ...empty, ok: false, reason: "error", error: call.error, latency_ms: latency };
  }

  const facts = safeParseFacts(call.text);
  const inTok  = Number((call.usage as any)?.input_tokens  || 0);
  const outTok = Number((call.usage as any)?.output_tokens || 0);
  const costEur = (inTok / 1_000_000) * PRICE_IN_PER_MTOK_EUR + (outTok / 1_000_000) * PRICE_OUT_PER_MTOK_EUR;

  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedLow = 0;

  for (const f of facts) {
    if (f.confidence < minConf) { skippedLow++; continue; }
    if (await findExistingFact(opts.user_id, String(opts.entity), f)) { skippedDuplicate++; continue; }
    const humanFact = factSentence(f);
    if (!humanFact) { skippedLow++; continue; }
    const { error } = await sb.from("assistant_memory").insert({
      user_id: opts.user_id,
      fact: humanFact,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object || null,
      kind: f.kind,
      entity_code: String(opts.entity),
      tags: f.tags && f.tags.length ? f.tags : null,
      confidence: f.confidence,
      source_conversation_id: null,
      scope: "global",
    });
    if (!error) inserted++;
    else skippedDuplicate++;
  }

  await logRun(opts, model, {
    turn_count: realTurns.length,
    facts_extracted: facts.length,
    facts_inserted: inserted,
    cost_eur: costEur,
    latency_ms: latency,
    input_tokens: inTok,
    output_tokens: outTok,
    error: null,
  });

  // Meter row for billing.
  await sb.from("assistant_actions").insert({
    user_id: opts.user_id,
    action_type: "memory.extract",
    action_kind: "memory_extract",
    entity_code: String(opts.entity),
    target_table: "assistant_memory",
    cost_eur: costEur,
    latency_ms: latency,
    model,
    input_tokens: inTok,
    output_tokens: outTok,
    payload: {
      session_id: opts.session_id,
      turn_count: realTurns.length,
      facts_extracted: facts.length,
      facts_inserted: inserted,
      skipped_duplicate: skippedDuplicate,
      skipped_low_confidence: skippedLow,
    },
    reversible: false,
  });

  return {
    ok: true,
    session_id: opts.session_id,
    reason: facts.length === 0 ? "no_facts" : undefined,
    facts,
    inserted,
    skipped_duplicate: skippedDuplicate,
    skipped_low_confidence: skippedLow,
    cost_eur: costEur,
    latency_ms: latency,
    model,
    input_tokens: inTok,
    output_tokens: outTok,
    error: null,
  };
}

async function logRun(opts: ExtractOpts, model: string, r: { turn_count: number; facts_extracted: number; facts_inserted: number; cost_eur: number; latency_ms: number; input_tokens: number; output_tokens: number; error: string | null }) {
  const sb = supabaseServer();
  await sb.from("assistant_memory_extractions").insert({
    session_id: opts.session_id,
    user_id: opts.user_id,
    entity_code: String(opts.entity),
    turn_count: r.turn_count,
    facts_extracted: r.facts_extracted,
    facts_inserted: r.facts_inserted,
    cost_eur: r.cost_eur,
    latency_ms: r.latency_ms,
    model,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    error: r.error,
  });
}
