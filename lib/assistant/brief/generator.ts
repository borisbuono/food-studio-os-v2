// Assistant Polish #2 — Daily Brief signal weaving.
//
// The Sprint 2 brief called the orchestrator with only the OS state block
// (covers, EOD, invoices, MEP). It ignored everything at the edges — the
// email triage overnight, WhatsApp signals, payment failures, new reviews,
// and the operator's own accumulated memory.
//
// The generator now assembles a richer pre-brief context:
//
//   - today       — covers booked + service-window state
//   - yesterday   — EOD posted, revenue, deviations
//   - money       — open invoices, unmatched bank, failing platforms
//   - overnight   — email triage (grouped by category), WA signals, new reviews
//   - memory      — reminders / birthdays / upcoming rows the operator has
//                   told the assistant about
//
// The orchestrator prompt is rebuilt to weave these into an editorial
// brief:
//   1) One-sentence headline
//   2) Priorities (3 things needing the operator)
//   3) Signals from overnight (email / WhatsApp / reviews)
//   4) Money picture
//   5) Already in hand (what the system handled)
//
// Idempotent per (entity, user, date). The API route decides whether to
// force a regen; this file always does the work when called.

import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";

// entity_code → restaurant_id for the tables that live on restaurants
// (bookings, eod_accounting, reviews). Mirrors the mapping in the
// orchestrator so the brief and the FAB agree.
const ENTITY_TO_RID: Record<string, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  BBH: "",
};

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function madridYesterday(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function ibizaHHmm(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  return hh + ":" + mm;
}

export type BriefPriority = { label: string; source: string; count?: number; amount_eur?: number };
export type BriefSignal   = { source: "email" | "whatsapp" | "review" | "payment" | "memory"; label: string; count: number; priority?: number };
export type BriefMoney    = { open_invoices: number; open_invoices_eur: number; unmatched_bank: number; failing_platforms: number; failing_labels: string[] };
export type BriefHandled  = { source: string; label: string; count: number };

export type BriefSignals = {
  today: {
    date: string;
    now_hhmm: string;
    covers_booked: number;
    service_phase: "before" | "during" | "after" | "unknown";
    upcoming_bookings: { time: string; party: number; name: string | null }[];
  };
  yesterday: {
    date: string;
    eod_posted: boolean;
    eod_revenue: number | null;
    eod_deviation: string | null;
  };
  priorities: BriefPriority[];
  signals: BriefSignal[];
  money: BriefMoney;
  handled: BriefHandled[];
  memory_highlights: { fact: string; kind: string | null }[];
};

export type BriefResult = {
  ok: boolean;
  entity: EntityCode | string;
  date: string;
  headline: string;
  body: string;
  signals: BriefSignals;
  cached: boolean;
  cost_eur: number | null;
  latency_ms: number | null;
  model: string | null;
  brief_id: string | null;
  error?: string | null;
};

// --- Signal assembly ------------------------------------------------------

async function assembleSignals(entity: EntityCode | string, userId: string | null): Promise<BriefSignals> {
  const sb = supabaseServer();
  const today = madridToday();
  const yesterday = madridYesterday();
  const rid = ENTITY_TO_RID[String(entity)] || null;
  const now24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const hh = Number(ibizaHHmm().slice(0, 2));
  const svc: BriefSignals["today"]["service_phase"] = hh < 19 ? "before" : hh < 24 ? "during" : "after";

  const [
    bookingsRes, eodTodayRes, eodYestRes, invopenRes, bankRes, platRes,
    triageRes, waEventsRes, reviewsRes, memoryRes,
  ] = await Promise.all([
    rid ? sb.from("bookings").select("service_time,party_size,guest_name,status").eq("restaurant_id", rid).eq("service_date", today).order("service_time", { ascending: true }) : Promise.resolve({ data: [] } as any),
    // 2026-08-07 wire fix -- eod_accounting is the manual-close journal (empty in prod);
    // eod_pos is the daily POS import (439 real BM rows). Read the POS table so the LLM
    // has yesterday's actual gross + covers instead of null.
    rid ? sb.from("eod_pos").select("total_gross_eur,covers,date").eq("restaurant_id", rid).eq("date", today).maybeSingle() : Promise.resolve({ data: null } as any),
    rid ? sb.from("eod_pos").select("total_gross_eur,covers,date,food_net_eur,wine_net_eur,tips_eur").eq("restaurant_id", rid).order("date", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null } as any),
    sb.from("invoice_inbox").select("amount_eur,match_status,flagged_reason").eq("entity_id", entity).not("match_status", "in", "(approved,rejected,duplicate)"),
    sb.from("bank_movements").select("id").eq("entity_id", entity).eq("reconciled_to", "unmatched"),
    sb.from("platform_billing_status").select("platform,state").eq("entity_code", entity).in("state", ["failing","disabled","at_risk"]),
    userId
      ? sb.from("assistant_actions").select("action_kind,payload,created_at").eq("user_id", userId).eq("action_kind", "triage").gte("created_at", now24).limit(50)
      : Promise.resolve({ data: [] } as any),
    userId
      ? sb.from("assistant_wa_events").select("event_type,body,from_number,received_at").eq("event_type", "message").gte("received_at", now24).limit(50)
      : Promise.resolve({ data: [] } as any),
    rid
      ? sb.from("reviews").select("rating,body,platform,posted_at").eq("restaurant_id", rid).is("response_body", null).gte("posted_at", now7d).order("posted_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] } as any),
    userId
      ? sb.from("assistant_memory").select("fact,kind").eq("user_id", userId).is("retired_at", null).in("kind", ["reminder","birthday","upcoming"]).limit(10)
      : Promise.resolve({ data: [] } as any),
  ]);

  // Today's bookings + upcoming list.
  const bookingsAll = (bookingsRes.data || []) as any[];
  const active = bookingsAll.filter((b) => !["cancelled","noshow","no_show"].includes(String(b.status || "").toLowerCase()));
  const covers = active.reduce((a, b) => a + Number(b.party_size || 0), 0);
  const upcoming = active
    .filter((b) => (b.service_time || "").slice(0, 5) > ibizaHHmm())
    .slice(0, 6)
    .map((b) => ({ time: String(b.service_time || "").slice(0, 5), party: Number(b.party_size || 0), name: b.guest_name || null }));

  // Yesterday's EOD.
  const eodY = (eodYestRes as any).data || null;
  const eodT = (eodTodayRes as any).data || null;

  // Money picture.
  const invopen = (invopenRes.data || []) as any[];
  const openEur = invopen.reduce((a, r) => a + Number(r.amount_eur || 0), 0);
  const bankUnmatched = ((bankRes.data || []) as any[]).length;
  const platRows = (platRes.data || []) as any[];
  const failingLabels = platRows.map((p) => String(p.platform) + " (" + String(p.state) + ")");

  // Overnight email triage — group by category on the triage rows' payload.verdicts.
  const triageActions = (triageRes.data || []) as any[];
  const emailCategories = new Map<string, number>();
  for (const a of triageActions) {
    const verdicts = (a.payload && Array.isArray((a.payload as any).verdicts)) ? (a.payload as any).verdicts : [];
    for (const v of verdicts) {
      const cat = String(v?.category || "other");
      emailCategories.set(cat, (emailCategories.get(cat) || 0) + 1);
    }
  }
  const emailSignals: BriefSignal[] = Array.from(emailCategories.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat, n]) => ({ source: "email", label: cat, count: n }));
  const emailTotal = triageActions.length;

  // WhatsApp — number of inbound messages overnight.
  const waEvents = (waEventsRes.data || []) as any[];
  const waSignals: BriefSignal[] = waEvents.length
    ? [{ source: "whatsapp", label: waEvents.length === 1 ? "1 inbound message" : `${waEvents.length} inbound messages`, count: waEvents.length }]
    : [];

  // Reviews awaiting reply.
  const reviews = (reviewsRes.data || []) as any[];
  const reviewSignals: BriefSignal[] = reviews.length
    ? [{ source: "review", label: reviews.length === 1 ? "1 review awaiting a reply" : `${reviews.length} reviews awaiting a reply`, count: reviews.length }]
    : [];
  const lowRatingCount = reviews.filter((r) => Number(r.rating || 5) <= 3).length;
  if (lowRatingCount > 0) reviewSignals.push({ source: "review", label: `${lowRatingCount} low-rating`, count: lowRatingCount, priority: 1 });

  // Payment picture — as a signal too, not just money.
  const paySignals: BriefSignal[] = failingLabels.length
    ? [{ source: "payment", label: failingLabels.length === 1 ? "1 platform payment in trouble" : `${failingLabels.length} platform payments in trouble`, count: failingLabels.length, priority: 1 }]
    : [];

  // Memory highlights.
  const memRows = (memoryRes.data || []) as any[];
  const memSignals: BriefSignal[] = memRows.length
    ? [{ source: "memory", label: memRows.length === 1 ? "1 reminder from memory" : `${memRows.length} reminders from memory`, count: memRows.length }]
    : [];

  // Priorities — a small stack of 3, drawn from the highest-stakes signals.
  const priorities: BriefPriority[] = [];
  if (failingLabels.length) priorities.push({ label: "Failing platform payments: " + failingLabels.slice(0, 3).join(", "), source: "payment", count: failingLabels.length });
  if (invopen.length > 0) priorities.push({ label: `${invopen.length} invoice${invopen.length > 1 ? "s" : ""} waiting`, source: "money", count: invopen.length, amount_eur: Math.round(openEur) });
  if (lowRatingCount > 0) priorities.push({ label: `${lowRatingCount} low review${lowRatingCount > 1 ? "s" : ""} to answer`, source: "review", count: lowRatingCount });
  if (upcoming.length > 0 && priorities.length < 3) priorities.push({ label: `${covers} covers today, next at ${upcoming[0].time}`, source: "service", count: covers });
  if (!eodY && rid && priorities.length < 3) priorities.push({ label: "POS import is stale — no recent trading-day row", source: "money" });
  else if (eodY && rid && priorities.length < 3) priorities.push({ label: `Last trading day: €${Math.round(Number((eodY as any).total_gross_eur || 0))} on ${(eodY as any).date}`, source: "eod", count: Number((eodY as any).covers || 0) });
  if (memRows.length && priorities.length < 3) priorities.push({ label: memRows[0].fact.slice(0, 100), source: "memory" });

  // Handled — everything the system already took care of.
  const handled: BriefHandled[] = [];
  if (eodT) handled.push({ source: "eod", label: `today's POS is in (€${Math.round(Number((eodT as any).total_gross_eur || 0))})`, count: 1 });
  if (emailTotal > 0) handled.push({ source: "email", label: `${emailTotal} email triage run${emailTotal > 1 ? "s" : ""} overnight`, count: emailTotal });
  // Approved / matched invoices in the last 24h — as "handled" hits.
  const handledInv = await sb.from("invoice_inbox").select("id").eq("entity_id", entity).in("match_status", ["approved","matched_albaran","matched_order"]).gte("triaged_at", now24);
  const handledInvCount = (handledInv.data || []).length;
  if (handledInvCount > 0) handled.push({ source: "money", label: `${handledInvCount} invoice${handledInvCount > 1 ? "s" : ""} triaged overnight`, count: handledInvCount });

  return {
    today: {
      date: today,
      now_hhmm: ibizaHHmm(),
      covers_booked: covers,
      service_phase: svc,
      upcoming_bookings: upcoming,
    },
    yesterday: {
      // note: eod_pos.date is the POS trading day (may be day-before yesterday
      // when the sync lags). eod_posted / eod_revenue reflect the LATEST row
      // -- what the operator would call "yesterday's number" in practice.
      date: eodY ? String((eodY as any).date || yesterday) : yesterday,
      eod_posted: !!eodY,
      eod_revenue: eodY ? Number((eodY as any).total_gross_eur || 0) : null,
      eod_deviation: null,
    },
    priorities: priorities.slice(0, 3),
    signals: [...emailSignals, ...waSignals, ...reviewSignals, ...paySignals, ...memSignals],
    money: {
      open_invoices: invopen.length,
      open_invoices_eur: Math.round(openEur),
      unmatched_bank: bankUnmatched,
      failing_platforms: failingLabels.length,
      failing_labels: failingLabels,
    },
    handled,
    memory_highlights: memRows.map((m) => ({ fact: m.fact, kind: m.kind })).slice(0, 6),
  };
}

// --- Prompt builder -------------------------------------------------------

function serialiseSignals(s: BriefSignals): string {
  const lines: string[] = [];
  lines.push(`TODAY (${s.today.date}, ${s.today.now_hhmm} Ibiza, service phase ${s.today.service_phase}):`);
  lines.push(`- covers booked: ${s.today.covers_booked}`);
  if (s.today.upcoming_bookings.length) {
    lines.push("- upcoming bookings:");
    for (const b of s.today.upcoming_bookings) lines.push(`  · ${b.time} — ${b.party} pax${b.name ? " (" + b.name + ")" : ""}`);
  }
  lines.push("");
  lines.push(`YESTERDAY (${s.yesterday.date}):`);
  lines.push(`- EOD posted: ${s.yesterday.eod_posted ? "yes · €" + Math.round(s.yesterday.eod_revenue || 0) : "no"}`);
  lines.push("");
  lines.push("PRIORITIES (three that need the operator today):");
  if (!s.priorities.length) lines.push("- none surfaced");
  else for (const p of s.priorities) lines.push(`- ${p.label}${p.amount_eur ? " (€" + p.amount_eur + ")" : ""}`);
  lines.push("");
  lines.push("SIGNALS OVERNIGHT:");
  if (!s.signals.length) lines.push("- quiet");
  else for (const g of s.signals) lines.push(`- [${g.source}] ${g.label}`);
  lines.push("");
  lines.push("MONEY PICTURE:");
  lines.push(`- ${s.money.open_invoices} invoice(s) waiting (€${s.money.open_invoices_eur})`);
  lines.push(`- ${s.money.unmatched_bank} bank movement(s) unmatched`);
  if (s.money.failing_platforms) lines.push(`- ${s.money.failing_platforms} platform payment(s) in trouble: ${s.money.failing_labels.slice(0,3).join(", ")}`);
  lines.push("");
  lines.push("ALREADY HANDLED BY THE SYSTEM:");
  if (!s.handled.length) lines.push("- nothing to note");
  else for (const h of s.handled) lines.push(`- ${h.label}`);
  if (s.memory_highlights.length) {
    lines.push("");
    lines.push("REMINDERS FROM MEMORY:");
    for (const m of s.memory_highlights) lines.push(`- ${m.fact}${m.kind ? " [" + m.kind + "]" : ""}`);
  }
  return lines.join("\n");
}

const BRIEF_PROMPT = `Write today's morning brief for the operator.

You have a structured signal assembly below. Weave it into 4 to 6 short editorial paragraphs — serif prose, no lists, no exclamation marks, no emojis. Match the entity's voice. Timezone-aware — use Ibiza local time.

Cover, in order:
1. Today's headline — one sentence at the top of your reply, prefaced by exactly "HEADLINE: " on its own line. Keep it under 18 words. This is what the operator reads first, before the paragraphs.
2. Priorities — three things needing the operator, woven into one paragraph.
3. Signals from overnight — email, WhatsApp, reviews, payment failures. One paragraph.
4. The money picture — open invoices, unmatched bank, failing platforms. One paragraph.
5. What's already in hand — anything the system handled. One short paragraph.
6. One small nudge — a warm closing sentence.

Rules:
- Only use numbers and names from the signal assembly. Never invent.
- If a section is empty, say so plainly ("Overnight was quiet.") rather than skip.
- Match the entity's voice (Bistro Mondo = warm, Taller Sa Penya = quiet modernist, Holdings = sober).
`;

function extractHeadline(text: string): { headline: string; body: string } {
  const trimmed = text.trim();
  const m = trimmed.match(/^\s*HEADLINE:\s*(.+?)(?:\r?\n){1,2}([\s\S]*)$/i);
  if (m) return { headline: m[1].trim(), body: m[2].trim() };
  // Fallback — first sentence of the first paragraph.
  const para = trimmed.split(/\n\n+/)[0] || "";
  const firstSent = para.split(/(?<=[.!?])\s+/)[0] || para;
  return { headline: firstSent.slice(0, 140), body: trimmed };
}

// --- Public: generate + persist ------------------------------------------

export type GenerateBriefOpts = {
  entity: EntityCode | string;
  user_id: string;
  date?: string;
  force?: boolean;
};

export async function generateBrief(opts: GenerateBriefOpts): Promise<BriefResult> {
  const sb = supabaseServer();
  const entity = opts.entity;
  const uid = opts.user_id;
  const date = opts.date || madridToday();

  // Idempotent — return the stored row unless force.
  if (!opts.force) {
    const { data: existing } = await sb.from("assistant_briefs")
      .select("*").eq("entity_code", entity).eq("user_id", uid).eq("date", date).maybeSingle();
    if (existing) {
      return {
        ok: true, entity, date,
        headline: (existing as any).headline || "",
        body: (existing as any).body || "",
        signals: ((existing as any).signals || defaultSignals(date)) as BriefSignals,
        cached: true, cost_eur: null, latency_ms: null, model: null,
        brief_id: (existing as any).id, error: null,
      };
    }
  }

  // Assemble + call the orchestrator.
  const [signals, memory, config] = await Promise.all([
    assembleSignals(entity, uid),
    orchestrator.getMemory(entity as EntityCode, uid),
    orchestrator.getConfig(entity as EntityCode),
  ]);
  const context = await orchestrator.getContext(entity as EntityCode, uid, { kind: "brief_signals", assembly: signals });

  const result = await orchestrator.generate({
    context, memory, config,
    prompt: BRIEF_PROMPT + "\n\nSIGNAL ASSEMBLY:\n" + serialiseSignals(signals),
    mode: "brief",
  });

  if (!result.ok) {
    return {
      ok: false, entity, date,
      headline: "", body: result.text || "",
      signals, cached: false,
      cost_eur: result.cost_eur, latency_ms: result.latency_ms, model: result.model,
      brief_id: null, error: result.text,
    };
  }

  const { headline, body } = extractHeadline(result.text);

  const { data: brief, error } = await sb.from("assistant_briefs")
    .upsert({
      entity_code: entity,
      user_id: uid,
      date,
      body,
      headline,
      signals,
    }, { onConflict: "entity_code,user_id,date" })
    .select("*").maybeSingle();

  if (error) {
    return {
      ok: false, entity, date, headline, body, signals, cached: false,
      cost_eur: result.cost_eur, latency_ms: result.latency_ms, model: result.model,
      brief_id: null, error: error.message,
    };
  }

  // Meter — the API route also does this but we double up when called from
  // batch jobs (cron) that don't route through /api/assistant/brief/generate.
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_type: "brief.generate",
    action_kind: "brief",
    entity_code: entity,
    target_table: "assistant_briefs",
    target_id: (brief as any)?.id || null,
    cost_eur: result.cost_eur,
    latency_ms: result.latency_ms,
    model: result.model,
    input_tokens:  result.input_tokens,
    output_tokens: result.output_tokens,
    payload: {
      entity, date, mode: "brief",
      signal_counts: {
        priorities: signals.priorities.length,
        signals: signals.signals.length,
        handled: signals.handled.length,
        memory: signals.memory_highlights.length,
      },
    },
    reversible: false,
  });

  return {
    ok: true, entity, date,
    headline,
    body,
    signals,
    cached: false,
    cost_eur: result.cost_eur,
    latency_ms: result.latency_ms,
    model: result.model,
    brief_id: (brief as any)?.id || null,
    error: null,
  };
}

function defaultSignals(date: string): BriefSignals {
  return {
    today: { date, now_hhmm: ibizaHHmm(), covers_booked: 0, service_phase: "unknown", upcoming_bookings: [] },
    yesterday: { date, eod_posted: false, eod_revenue: null, eod_deviation: null },
    priorities: [], signals: [], money: { open_invoices: 0, open_invoices_eur: 0, unmatched_bank: 0, failing_platforms: 0, failing_labels: [] },
    handled: [], memory_highlights: [],
  };
}
