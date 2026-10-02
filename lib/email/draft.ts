// lib/email/draft.ts — the suggested reply for an email thread. Server-only.
//
// Haiku in the OS (Boris ruled 2026-09-22 for comments; the same path here).
// The drafter reads, per entity: brand_voice_examples (approved past replies,
// tone notes, phrases to avoid), social_saved_replies (SHARED with the Meta
// inbox — one canned-answer list per house), the pricing rules the house has
// written down (entities.metadata.pricing_rules, brand_kits.ethos) and — E6 —
// the one-line counterparty note for the sender. Reply language = sender's.
//
// An enquiry draft never quotes a price the house has not written down; it
// carries the proposal link prefilled from enquiry_fields instead.
//
// Nothing here sends. It writes draft_reply + status 'drafted'. The only path
// out is the edge function email-reply (E4), behind approved_by_boris + a
// consumed confirm token.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, INBOX_MODEL } from "@/lib/social/inboxDraft";
import type { Category, EnquiryFields } from "@/lib/email/rules";

export const EMAIL_DRAFT_MODEL = process.env.EMAIL_DRAFT_MODEL || INBOX_MODEL;
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.foodstudio.ai";

export type DraftResult = { ok: boolean; status?: "drafted" | "flagged" | "skipped"; lang?: string | null; reply?: string | null; flag_reason?: string | null; error?: string };

function stripJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// /m/<public_slug>/proposal?… — E5 renders this page prefilled; until then
// the same query lands on the existing private-events form.
export function proposalLink(publicSlug: string | null, f: EnquiryFields | null | undefined, threadId: string): string | null {
  if (!publicSlug) return null;
  const q = new URLSearchParams();
  if (f?.date) q.set("date", f.date);
  if (f?.pax) q.set("pax", String(f.pax));
  if (f?.budget_pp) q.set("budget_pp", String(f.budget_pp));
  if (f?.venue_case) q.set("venue", f.venue_case);
  if (f?.food_shape) q.set("shape", f.food_shape);
  if (f?.language) q.set("lang", f.language);
  q.set("ref", threadId.slice(0, 8));
  return `${SITE}/m/${publicSlug}/proposal?${q}`;
}

function venueVoice(slug: string, name: string): string {
  if (slug === "bm") return `Venue: Bistro Mondo (${name}), Ibiza. Voice: Boris in his less serious form — a neighbourhood restaurant, almost a little family. Warm, direct, a bit playful, never corporate, never salesy.`;
  if (slug === "taller") return `Venue: Ibiza Food Studio / Taller Sa Penya (${name}), Ibiza — private dining, cooking experiences, events, private chef. Voice: Boris, personal and warm, quieter and more considered than at the bistro. Never corporate, never salesy.`;
  return `Venue: ${name}. Voice: the owner writing personally — warm, direct, short, never corporate.`;
}

export function buildEmailSystemPrompt(o: {
  slug: string; name: string; category: Category | null;
  voice: Array<{ kind: string; lang: string | null; prompt_text: string | null; text: string; note: string | null }>;
  saved: Array<{ key: string; title: string; lang: string; body: string }>;
  pricing: string | null; ethos: string | null; counterpartyNote: string | null; proposal: string | null; signature: string | null;
}): string {
  const tone = o.voice.filter((v) => v.kind === "tone_note").map((v) => `- ${v.text}`).join("\n");
  const avoid = o.voice.filter((v) => v.kind === "avoid_phrase").map((v) => `- "${v.text}"`).join("\n");
  const examples = o.voice.filter((v) => v.kind === "approved_reply").slice(0, 10)
    .map((v) => `They wrote: ${JSON.stringify((v.prompt_text ?? "").slice(0, 400))}\nBoris replied: ${JSON.stringify(v.text)}`).join("\n\n");
  const canned = o.saved.map((s) => `[${s.key} · ${s.lang}] ${s.title}: ${s.body}`).join("\n");
  return [
    `You draft Boris's reply to an email his restaurant received. Boris reads and ticks every reply himself before it goes out; you only suggest.`,
    venueVoice(o.slug, o.name),
    o.category ? `The OS sorted this thread as: ${o.category}.` : ``,
    ``,
    `RULES`,
    `1. Reply in the language the sender wrote in. Match their register (tú/usted, first names if they used one).`,
    `2. Short. Three to six sentences. Greet by first name if known. No "Dear valued customer", no exclamation-mark walls, no bullet lists unless they asked a list of questions.`,
    `3. NEVER invent facts: no prices, no dates, no availability, no menu claims, no opening hours that are not in PRICING / SAVED REPLIES below. If the answer is not there, say Boris will confirm it — do not guess.`,
    o.proposal
      ? `4. For an enquiry (event, private dinner, private chef, class, group): do NOT quote a full price list. Acknowledge what they asked for (date, people, where, style — use exactly what they wrote, nothing more), say we would love to, and include this link once, on its own line, so they can complete the few details we need for a proposal: ${o.proposal}`
      : `4. For an enquiry: acknowledge exactly what they asked for and say Boris will come back with a proposal. Do not quote prices.`,
    `5. Booking change: confirm you have read what they want to change and that we will confirm the change — never state a table is available.`,
    `6. HARD RULE: never mention stars, Michelin, guides, awards or rankings. Not even to deny them.`,
    `7. If the mail is a complaint, a refund / money dispute, an allergy incident, anything legal or fiscal, press, a partnership that needs a decision, or something you cannot answer honestly → do NOT draft. Return kind "flag" with a one-line reason. Boris writes those himself.`,
    `8. Never promise on Boris's behalf (free things, discounts, held dates).`,
    o.signature ? `9. End with exactly this signature on its own line(s):\n${o.signature}` : `9. End with a one-word warm closing and "Boris". Nothing else after it.`,
    `10. Plain text only. No markdown, no HTML, no subject line.`,
    ``,
    o.counterpartyNote ? `WHAT WE KNOW ABOUT THIS SENDER (use it, don't quote it)\n${o.counterpartyNote}` : ``,
    o.pricing ? `PRICING THE HOUSE HAS WRITTEN DOWN (the only prices you may state, and only if asked)\n${o.pricing}` : `PRICING: none written down — never state a price.`,
    o.ethos ? `HOUSE ETHOS\n${o.ethos.slice(0, 800)}` : ``,
    tone ? `TONE NOTES FROM BORIS\n${tone}` : ``,
    avoid ? `PHRASES BORIS NEVER USES\n${avoid}` : ``,
    examples ? `REPLIES BORIS HAS APPROVED BEFORE (match this voice)\n${examples}` : ``,
    canned ? `SAVED REPLIES (reuse the facts and links in these when the question matches; adapt wording, keep facts)\n${canned}` : ``,
    ``,
    `OUTPUT: JSON only, no prose around it:`,
    `{"lang":"<ISO 639-1>","kind":"reply"|"flag","reply":"<the full reply text, or empty when flag>","flag_reason":"<why Boris should write it, or empty>"}`,
  ].filter((l) => l !== undefined).join("\n");
}

export async function draftThread(db: SupabaseClient, threadId: string, opts: { force?: boolean } = {}): Promise<DraftResult> {
  const { data: t } = await db.from("email_threads").select("id, entity_id, account_id, status, category, flagged, enquiry_fields, subject, from_address, from_name").eq("id", threadId).maybeSingle();
  if (!t) return { ok: false, error: "not_found" };
  const thread = t as any;
  if (!opts.force && !["classified", "drafted"].includes(thread.status)) return { ok: false, error: `status ${thread.status}, not drafting` };
  if (thread.flagged) return { ok: true, status: "skipped", error: "flagged — Boris writes it" };
  if (thread.category && !["enquiry", "booking_change", "other"].includes(thread.category)) return { ok: true, status: "skipped", error: `${thread.category} is not drafted` };
  // "other" gets a card but no draft (brief) unless a human asks for one
  if (thread.category === "other" && !opts.force) return { ok: true, status: "skipped", error: "other: card only" };

  const [{ data: ent }, { data: acc }, { data: msgs }] = await Promise.all([
    db.from("entities").select("id, slug, name, metadata").eq("id", thread.entity_id).single(),
    db.from("email_accounts").select("address, display_name").eq("id", thread.account_id).maybeSingle(),
    db.from("email_messages").select("direction, from_name, from_address, body_text, received_at, attachments").eq("thread_id", threadId).order("received_at", { ascending: false }).limit(8),
  ]);
  if (!ent) return { ok: false, error: "entity not found" };
  const [{ data: voice }, { data: saved }, { data: kit }, { data: rest }, { data: cp }] = await Promise.all([
    db.from("brand_voice_examples").select("kind, lang, prompt_text, text, note").eq("entity_id", ent.id).order("created_at", { ascending: false }).limit(40),
    db.from("social_saved_replies").select("key, title, lang, body").eq("entity_id", ent.id).eq("active", true).order("sort"),
    db.from("brand_kits").select("ethos").eq("entity_id", ent.id).maybeSingle(),
    db.from("restaurants").select("public_slug").eq("entity_id", ent.id).maybeSingle(),
    // E6: the one line we know about the sender — a client of this house, or a
    // supplier (shared across houses, entity_id null). First match wins.
    db.from("email_counterparties").select("name, kind, notes, side, entity_id").eq("address", String(thread.from_address || "").toLowerCase())
      .or(`entity_id.eq.${ent.id},entity_id.is.null`).order("entity_id", { ascending: false, nullsFirst: false }).limit(1).maybeSingle().then((r: any) => r, () => ({ data: null })),
  ]);
  const meta = ((ent as any).metadata || {}) as Record<string, unknown>;
  const pricing = typeof meta.pricing_rules === "string" ? String(meta.pricing_rules).slice(0, 2000) : null;
  const signature = typeof meta.email_signature === "string" ? String(meta.email_signature).slice(0, 300) : null;
  const proposal = thread.category === "enquiry" ? proposalLink((rest as any)?.public_slug || null, thread.enquiry_fields as EnquiryFields | null, threadId) : null;
  const cpNote = cp && (cp as any).notes ? `${(cp as any).name ? (cp as any).name + " · " : ""}${(cp as any).kind ? (cp as any).kind + " · " : ""}${String((cp as any).notes).replace(/\s+/g, " ").trim().slice(0, 300)}` : null;

  const system = buildEmailSystemPrompt({
    slug: ent.slug, name: ent.name, category: thread.category, voice: (voice ?? []) as any, saved: (saved ?? []) as any,
    pricing, ethos: (kit as any)?.ethos || null, counterpartyNote: cpNote, proposal, signature,
  });
  const history = ((msgs ?? []) as any[]).slice().reverse();
  const lines = history.map((m) => `${m.direction === "in" ? (m.from_name || m.from_address || "them") : "Boris"} (${m.received_at ? String(m.received_at).slice(0, 16) : "?"}):\n${String(m.body_text || "(no text)").slice(0, 2500)}${Array.isArray(m.attachments) && m.attachments.length ? `\n[attachments: ${m.attachments.map((a: any) => a.filename).join(", ")}]` : ""}`);
  const user = [
    `Mailbox: ${(acc as any)?.address || ""}`,
    `Subject: ${thread.subject || "(none)"}`,
    thread.enquiry_fields ? `Fields the OS read from the mail (only repeat what is non-null): ${JSON.stringify(thread.enquiry_fields)}` : ``,
    `Thread, oldest first:`,
    ...lines,
    ``,
    `Draft the reply to their last message.`,
  ].filter(Boolean).join("\n\n");

  let parsed: any = null;
  try { parsed = stripJson(await callClaude(system, user, 900)); }
  catch (e: any) {
    const msg = String(e?.message || e);
    await db.from("email_threads").update({ error: `draft: ${msg}`.slice(0, 400) }).eq("id", threadId);
    return { ok: false, error: msg };
  }
  if (!parsed) {
    await db.from("email_threads").update({ error: "draft: model returned no JSON" }).eq("id", threadId);
    return { ok: false, error: "no JSON" };
  }
  const lang = typeof parsed.lang === "string" ? parsed.lang.slice(0, 5).toLowerCase() : null;
  const reply = String(parsed.reply ?? "").trim();
  const flag = parsed.kind === "flag" || (!reply && parsed.flag_reason);
  const now = new Date().toISOString();
  // belt and braces on the hard rules: stars/guides, or a € figure when no pricing is written down
  const violates = /michelin|\bstars?\b|estrellas?|\bguía\b|⭐/i.test(reply) || (!pricing && /\d\s?(€|eur\b|euros?\b)|€\s?\d/i.test(reply));
  if (flag || violates) {
    const reason = violates ? "draft stated a price or mentioned stars — write it yourself" : String(parsed.flag_reason ?? "needs Boris").slice(0, 300);
    await db.from("email_threads").update({ status: "drafted", flagged: true, flag_reason: reason, draft_reply: null, draft_lang: lang, draft_at: now, draft_model: EMAIL_DRAFT_MODEL, error: null }).eq("id", threadId);
    return { ok: true, status: "flagged", lang, reply: null, flag_reason: reason };
  }
  await db.from("email_threads").update({ status: "drafted", flagged: false, flag_reason: null, draft_reply: reply, draft_lang: lang, draft_at: now, draft_model: EMAIL_DRAFT_MODEL, error: null }).eq("id", threadId);
  return { ok: true, status: "drafted", lang, reply };
}

// Catch-up: classified enquiries / booking changes that never got a draft.
export async function sweepDrafts(db: SupabaseClient, limit = 15): Promise<{ drafted: number; flagged: number; failed: number }> {
  const out = { drafted: 0, flagged: 0, failed: 0 };
  const { data } = await db.from("email_threads").select("id").eq("status", "classified").in("category", ["enquiry", "booking_change"]).eq("flagged", false)
    .order("last_received_at", { ascending: false }).limit(limit);
  for (const r of data || []) {
    const d = await draftThread(db, (r as any).id);
    if (!d.ok) out.failed++; else if (d.status === "flagged") out.flagged++; else if (d.status === "drafted") out.drafted++;
  }
  return out;
}
