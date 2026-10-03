// lib/email/funnel.ts — E5: an email enquiry IS a lead. Server-only.
//
// The moment a thread is sorted as `enquiry` (or a human re-sorts it to one),
// the fields the OS read — date, pax, budget_pp, venue_case, food_shape,
// language — open a `leads` row (source 'inbound-email', the funnel Boris
// already reviews at /studio/growth) and the thread points at it
// (email_threads.lead_id). The proposal link in the draft carries
// `ref=<thread id prefix>`; when the guest completes /m/<slug>/proposal the
// capture endpoint finds the same lead by utm_content 'email:<ref>' and
// fills it in, instead of opening a second one.
//
// Never a price: this module moves fields, it never computes a quote.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnquiryFields } from "@/lib/email/rules";

export const EMAIL_LEAD_SOURCE = "inbound-email";
export function emailRef(threadId: string): string { return `email:${threadId.slice(0, 8)}`; }

// What the funnel shows as the message — the facts the OS read, nothing invented.
export function enquirySummary(f: EnquiryFields | null | undefined, subject: string | null, snippet: string | null): string {
  const parts: string[] = [];
  if (f?.date) parts.push(`date ${f.date}`);
  if (f?.pax) parts.push(`${f.pax} pax`);
  if (f?.budget_pp) parts.push(`budget ~${f.budget_pp} €/pp (their words)`);
  if (f?.venue_case) parts.push(f.venue_case === "ours" ? "at our venue" : f.venue_case === "provider" ? "their venue" : "needs a venue");
  if (f?.food_shape) parts.push(f.food_shape);
  const head = parts.length ? parts.join(" · ") : "";
  const body = [subject ? `Subject: ${subject}` : "", snippet || ""].filter(Boolean).join("\n");
  return [head, body].filter(Boolean).join("\n").slice(0, 4000);
}

export type LeadLinkResult = { ok: boolean; lead_id: string | null; created: boolean; error?: string };

// Idempotent: a thread opens at most one lead. Returns the id either way.
export async function ensureLeadForThread(svc: SupabaseClient, threadId: string): Promise<LeadLinkResult> {
  const { data: t, error } = await svc.from("email_threads")
    .select("id, entity_id, category, enquiry_fields, subject, snippet, from_address, from_name, lead_id, first_received_at")
    .eq("id", threadId).maybeSingle();
  if (error || !t) return { ok: false, lead_id: null, created: false, error: error?.message || "not_found" };
  const th = t as any;
  if (th.lead_id) return { ok: true, lead_id: th.lead_id, created: false };
  if (th.category !== "enquiry") return { ok: true, lead_id: null, created: false };
  const ref = emailRef(threadId);
  // already opened (e.g. the thread was re-sorted away and back)
  const { data: have } = await svc.from("leads").select("id").eq("source", EMAIL_LEAD_SOURCE).eq("utm_content", ref).maybeSingle();
  if (have?.id) {
    await svc.from("email_threads").update({ lead_id: have.id }).eq("id", threadId);
    return { ok: true, lead_id: have.id, created: false };
  }
  const f = (th.enquiry_fields || null) as EnquiryFields | null;
  const pax = f?.pax && f.pax >= 1 && f.pax <= 200 ? Math.floor(f.pax) : null;
  const row = {
    entity_id: th.entity_id, source: EMAIL_LEAD_SOURCE, intent: "event",
    utm_source: "email", utm_medium: "inbox", utm_content: ref,
    email: th.from_address ? String(th.from_address).toLowerCase() : null, name: th.from_name || null,
    party_size: pax, requested_date: f?.date || null,
    message: enquirySummary(f, th.subject, th.snippet),
    state: "new",
    state_history: [{ at: new Date().toISOString(), state: "new", by: "email_channel", source: EMAIL_LEAD_SOURCE, thread_id: threadId, received_at: th.first_received_at || null }],
  };
  const { data: ins, error: insErr } = await svc.from("leads").insert(row).select("id").maybeSingle();
  if (insErr || !ins?.id) return { ok: false, lead_id: null, created: false, error: insErr?.message || "insert failed" };
  await svc.from("email_threads").update({ lead_id: ins.id }).eq("id", threadId);
  return { ok: true, lead_id: ins.id, created: true };
}

// The reply went out → the lead is 'contacted'. Outcome → converted / lost.
const OUTCOME_STATE: Record<string, string> = { won: "converted", lost: "lost", no_answer: "lost", not_sales: "lost" };
export async function advanceLead(svc: SupabaseClient, threadId: string, event: "replied" | "won" | "lost" | "no_answer" | "not_sales"): Promise<void> {
  const { data: t } = await svc.from("email_threads").select("lead_id").eq("id", threadId).maybeSingle();
  const leadId = (t as any)?.lead_id;
  if (!leadId) return;
  const { data: lead } = await svc.from("leads").select("state, state_history").eq("id", leadId).maybeSingle();
  if (!lead) return;
  const next = event === "replied" ? ((lead as any).state === "new" ? "contacted" : null) : OUTCOME_STATE[event] || null;
  if (!next || next === (lead as any).state) return;
  const hist = Array.isArray((lead as any).state_history) ? (lead as any).state_history : [];
  await svc.from("leads").update({
    state: next, lost_reason: event === "won" || event === "replied" ? null : event,
    state_history: [...hist, { at: new Date().toISOString(), state: next, by: "email_channel", event }],
  }).eq("id", leadId);
}
