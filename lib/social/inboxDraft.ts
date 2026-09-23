// lib/social/inboxDraft.ts — suggested replies for the Meta comment + DM inbox.
//
// Spec §5 (TO_OS_build_prompt_comments_dms_2026-09-23.md):
//   • reply in the language the person used; short, warm, never corporate
//   • Bistro Mondo voice: Boris in his less serious form — neighbourhood
//     restaurant, almost a little family
//   • never invent prices, dates or availability; if unknown, ask them to DM/call
//   • job enquiry → apply link (foodstudio.ai/apply/<slug>)
//   • booking question → shop.fresto.io/en/bistro-mondo/booking (BM only)
//   • hard rule: no stars, no Michelin, ever
//   • complaint or legal matter → FLAG, do not draft
//
// Boris ruled 2026-09-22: drafting is Haiku inside the OS (not a COM handoff).
// The drafter reads brand_voice_examples (approved past replies, tone notes,
// phrases to avoid) and social_saved_replies so it sounds like him, not like
// a model. Nothing here sends: it writes draft_reply and status 'drafted'.
// meta-reply is the only path out, and it needs approved_by_boris.
//
// Server-only. Called by /api/inbox/draft (secret-gated) — never from a page.

import type { SupabaseClient } from "@supabase/supabase-js";

export const INBOX_MODEL = process.env.INBOX_DRAFT_MODEL || "claude-haiku-4-5-20251001";

export type DraftKind = "comment" | "dm";

export interface DraftResult {
  ok: boolean;
  status?: "drafted" | "flagged";
  lang?: string | null;
  reply?: string | null;
  flag_reason?: string | null;
  error?: string;
}

const APPLY_BASE = "https://foodstudio.ai/apply";
// Booking links are facts. Only the ones we know; anything else → "DM us".
const BOOKING_LINKS: Record<string, string> = {
  bm: "https://shop.fresto.io/en/bistro-mondo/booking",
};

function stripJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callClaude(system: string, user: string, max_tokens = 600): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: INBOX_MODEL, max_tokens, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `anthropic ${r.status}`);
  return data?.content?.[0]?.text || "";
}

function venueVoice(slug: string, name: string): string {
  if (slug === "bm") {
    return `Venue: Bistro Mondo (${name}), Ibiza. Voice: Boris in his less serious form. A neighbourhood restaurant, almost a little family. Warm, direct, a bit playful, never corporate, never salesy.`;
  }
  return `Venue: ${name} (Ibiza Food Studio / Taller), Ibiza. Voice: Boris, personal and warm, a touch quieter and more considered than at the bistro. Never corporate, never salesy.`;
}

export function buildSystemPrompt(opts: {
  slug: string; name: string; voice: Array<{ kind: string; lang: string | null; prompt_text: string | null; text: string; note: string | null }>;
  saved: Array<{ key: string; title: string; lang: string; body: string }>;
}): string {
  const apply = `${APPLY_BASE}/${opts.slug}?src=` ; // the caller appends dm|ig|fb
  const booking = BOOKING_LINKS[opts.slug] ?? null;
  const tone = opts.voice.filter((v) => v.kind === "tone_note").map((v) => `- ${v.text}`).join("\n");
  const avoid = opts.voice.filter((v) => v.kind === "avoid_phrase").map((v) => `- "${v.text}"`).join("\n");
  const examples = opts.voice.filter((v) => v.kind === "approved_reply").slice(0, 12)
    .map((v) => `They wrote: ${JSON.stringify(v.prompt_text ?? "")}\nBoris replied: ${JSON.stringify(v.text)}`).join("\n\n");
  const canned = opts.saved.map((s) => `[${s.key} · ${s.lang}] ${s.title}: ${s.body}`).join("\n");

  return [
    `You draft Boris's replies to Instagram/Facebook comments and DMs. Boris ticks every reply himself before it goes out; you only suggest.`,
    venueVoice(opts.slug, opts.name),
    ``,
    `RULES`,
    `1. Reply in the language the person wrote in (Spanish, English, German, Dutch, French, Italian, Catalan...). Match their register. If they wrote only emoji, reply in the venue's most likely language for that person (default English) — one short warm line or an emoji back.`,
    `2. Short. One to three sentences for a comment; a DM can be a little longer if they asked something. Never corporate, no "Dear valued customer", no exclamation-mark walls, no hashtags.`,
    `3. Never invent facts: no prices, no dates, no opening hours, no availability, no menu claims you were not given. If the answer is not in the saved replies below, say you will confirm and ask them to DM or call.`,
    `4. Job enquiry (asking for work, sending a CV, "are you hiring", "busco trabajo") → include the apply link exactly: ${apply}SRC where SRC is "dm", "ig" or "fb" depending on the channel given.`,
    booking ? `5. Booking question → include exactly: ${booking}` : `5. Booking question → we have no booking link on file for this venue: ask them to DM or call.`,
    `6. HARD RULE: never mention stars, Michelin, guides, awards or rankings. Not even to deny them.`,
    `7. If the message is a complaint, a bad experience, a refund/money dispute, an allergy incident, anything legal, threatening, press/media, or a partnership/collab pitch that needs a decision → do NOT draft. Return kind "flag" with a one-line reason. Boris writes those himself.`,
    `8. Never promise anything on Boris's behalf (free meals, discounts, reservations held).`,
    `9. Sign nothing. No "— Boris". No name at the end.`,
    ``,
    tone ? `TONE NOTES FROM BORIS\n${tone}` : ``,
    avoid ? `PHRASES BORIS NEVER USES\n${avoid}` : ``,
    examples ? `REPLIES BORIS HAS APPROVED BEFORE (match this voice)\n${examples}` : ``,
    canned ? `SAVED REPLIES (reuse the facts and links in these when the question matches; adapt wording, keep facts)\n${canned}` : ``,
    ``,
    `OUTPUT: JSON only, no prose around it:`,
    `{"lang":"<ISO 639-1 of the person's message>","kind":"reply"|"flag","reply":"<the reply, or empty when flag>","flag_reason":"<why Boris should write it, or empty>"}`,
  ].filter((l) => l !== undefined).join("\n");
}

/* Load context and draft one item. Writes the result to the row. */
export async function draftItem(db: SupabaseClient, kind: DraftKind, id: string): Promise<DraftResult> {
  const table = kind === "comment" ? "social_comments" : "social_dm_messages";
  const { data: row, error } = await db.from(table).select("*").eq("id", id).single();
  if (error || !row) return { ok: false, error: "not_found" };
  if (!["new", "drafted"].includes(row.status)) return { ok: false, error: `status ${row.status}, not drafting` };
  if (kind === "dm" && row.direction !== "in") return { ok: false, error: "outbound message" };

  const { data: ent } = await db.from("entities").select("id, slug, name").eq("id", row.entity_id).single();
  if (!ent) return { ok: false, error: "entity not found" };

  const [{ data: voice }, { data: saved }] = await Promise.all([
    db.from("brand_voice_examples").select("kind, lang, prompt_text, text, note")
      .eq("entity_id", ent.id).order("created_at", { ascending: false }).limit(40),
    db.from("social_saved_replies").select("key, title, lang, body").eq("entity_id", ent.id).eq("active", true).order("sort"),
  ]);

  let channel = "ig", context = "";
  if (kind === "comment") {
    channel = row.platform === "facebook" ? "fb" : "ig";
    const { data: acc } = await db.from("social_accounts_resolved").select("handle").eq("account_id", row.account_id).maybeSingle();
    context = [
      `Channel: ${row.platform} comment on our account ${acc?.handle ?? ""}`,
      row.media_caption ? `Our post caption: ${JSON.stringify(String(row.media_caption).slice(0, 500))}` : ``,
      row.parent_remote_id ? `This is a reply inside a comment thread.` : ``,
      `From: ${row.author_handle ?? row.author_name ?? "someone"}`,
      `They wrote: ${JSON.stringify(row.text ?? "")}`,
    ].filter(Boolean).join("\n");
  } else {
    channel = "dm";
    const { data: thread } = await db.from("social_dm_threads").select("participant_handle, participant_name, account_id").eq("id", row.thread_id).single();
    const { data: history } = await db.from("social_dm_messages").select("direction, text, sent_at")
      .eq("thread_id", row.thread_id).order("sent_at", { ascending: false }).limit(8);
    const lines = (history ?? []).slice().reverse().map((m: any) =>
      `${m.direction === "in" ? (thread?.participant_handle ?? "them") : "Boris"}: ${JSON.stringify(m.text ?? "")}`);
    context = [
      `Channel: Instagram DM with ${thread?.participant_handle ?? thread?.participant_name ?? "someone"}`,
      `Conversation so far (oldest first):`,
      ...lines,
      `Draft the reply to their last message.`,
    ].join("\n");
  }

  const system = buildSystemPrompt({ slug: ent.slug, name: ent.name, voice: (voice ?? []) as any, saved: (saved ?? []) as any });
  const user = `${context}\n\nChannel code for the apply link: ${channel}`;

  let parsed: any = null;
  try {
    const txt = await callClaude(system, user);
    parsed = stripJson(txt);
  } catch (e: any) {
    const msg = String(e?.message || e);
    await db.from(table).update({ error: `draft: ${msg}` }).eq("id", id);
    return { ok: false, error: msg };
  }
  if (!parsed) {
    await db.from(table).update({ error: "draft: model returned no JSON" }).eq("id", id);
    return { ok: false, error: "no JSON" };
  }

  const lang = typeof parsed.lang === "string" ? parsed.lang.slice(0, 5).toLowerCase() : null;
  const reply = String(parsed.reply ?? "").trim();
  const flag = parsed.kind === "flag" || (!reply && parsed.flag_reason);
  const now = new Date().toISOString();

  // Belt and braces on the hard rule — a draft that slipped a star through is
  // flagged, not sent.
  const violates = /michelin|\bstars?\b|estrellas?|\bguía\b|guide michelin|⭐/i.test(reply);

  if (flag || violates) {
    const reason = violates ? "draft mentioned stars/guides — write it yourself" : String(parsed.flag_reason ?? "needs Boris").slice(0, 300);
    await db.from(table).update({
      status: "drafted", flagged: true, flag_reason: reason, lang,
      draft_reply: null, draft_lang: lang, draft_at: now, draft_model: INBOX_MODEL, error: null,
    }).eq("id", id);
    return { ok: true, status: "flagged", lang, reply: null, flag_reason: reason };
  }

  await db.from(table).update({
    status: "drafted", flagged: false, flag_reason: null, lang,
    draft_reply: reply, draft_lang: lang, draft_at: now, draft_model: INBOX_MODEL, error: null,
  }).eq("id", id);
  return { ok: true, status: "drafted", lang, reply };
}

/* Catch-up: anything still at 'new' (trigger call lost, Vercel cold, etc.). */
export async function sweepNew(db: SupabaseClient, limit = 25): Promise<{ drafted: number; flagged: number; failed: number }> {
  const out = { drafted: 0, flagged: 0, failed: 0 };
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: cs }, { data: ds }] = await Promise.all([
    db.from("social_comments").select("id").eq("status", "new").gte("created_at_remote", since)
      .order("created_at_remote", { ascending: false }).limit(limit),
    db.from("social_dm_messages").select("id").eq("status", "new").eq("direction", "in").gte("sent_at", since)
      .order("sent_at", { ascending: false }).limit(limit),
  ]);
  const jobs: Array<[DraftKind, string]> = [
    ...((cs ?? []).map((c: any) => ["comment", c.id] as [DraftKind, string])),
    ...((ds ?? []).map((d: any) => ["dm", d.id] as [DraftKind, string])),
  ].slice(0, limit);
  for (const [k, id] of jobs) {
    const r = await draftItem(db, k, id);
    if (!r.ok) out.failed++; else if (r.status === "flagged") out.flagged++; else out.drafted++;
  }
  return out;
}
