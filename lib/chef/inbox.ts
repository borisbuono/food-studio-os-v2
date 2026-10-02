// Chef v3 Phase 2 — the inbox, one card at a time. Server only.
//
// "cuántos comentarios esperan" is a count (Phase 1). "abre la bandeja" /
// "siguiente" walks the waiting comments one card at a time: the comment,
// the Haiku draft, and Send / Skip / Edit. Send is an outbound write, so it
// always goes through the read-back gate; the client never calls meta-reply
// itself — /api/chef/act does, through lib/social/inboxAct (the same gate
// the inbox page uses).
//
// Email E4 (2026-10-02): the same walk now carries email threads (Comms ›
// Inbox cards, kind "email"). "answer the Harmke email" → one card → read-back
// → yes. Send goes through lib/email/reply → edge function email-reply, which
// re-checks the consumed token. Never auto-send.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefAction, ChefCard, ChefLang } from "@/lib/chef/types";

export type WaitingItem = {
  id: string;
  kind: "comment" | "email";
  platform: string | null;
  author: string;
  text: string;
  draft: string | null;
  flagged: boolean;
  flag_reason: string | null;
  permalink: string | null;
  created_at_remote: string | null;
  // email only
  subject?: string | null;
  category?: string | null;
  read?: string | null;        // what the OS read: "2026-11-14 · 14 pax · their venue"
};

export type InboxChannel = "all" | "social" | "email";

const S = {
  es: {
    reply_to: (a: string) => "Responder a " + a,
    send: "Enviar", skip: "Saltar", edit: "Editar", next: "Siguiente",
    no_draft: "Sin borrador todavía",
    flagged: (r: string) => "Marcado: " + r,
    readback: (a: string, d: string) => "Respondo a " + a + ": «" + d + "». ¿Envío?",
    left: (n: number) => n + " más esperando",
    none: "Bandeja al día",
    not_found: (w: string) => "No encuentro un comentario de " + w,
    many: (w: string, n: number) => n + " comentarios de " + w + " — ¿cuál?",
    email_not_found: (w: string) => "No encuentro un email de " + w + " esperando",
    email_many: (w: string, n: number) => n + " emails de " + w + " — ¿cuál?",
    answer: (a: string) => "Responder a " + a + " · email",
    email_readback: (a: string, d: string) => "Respondo por email a " + a + ": «" + d + "». ¿Envío?",
    enquiries: (n: number) => n + (n === 1 ? " consulta esperando" : " consultas esperando"),
  },
  en: {
    reply_to: (a: string) => "Reply to " + a,
    send: "Send", skip: "Skip", edit: "Edit", next: "Next",
    no_draft: "No draft yet",
    flagged: (r: string) => "Flagged: " + r,
    readback: (a: string, d: string) => "Reply to " + a + ": “" + d + "”. Send it?",
    left: (n: number) => n + " more waiting",
    none: "Inbox clear",
    not_found: (w: string) => "No waiting comment from " + w,
    many: (w: string, n: number) => n + " comments from " + w + " — which one?",
    email_not_found: (w: string) => "No waiting email from " + w,
    email_many: (w: string, n: number) => n + " emails from " + w + " — which one?",
    answer: (a: string) => "Answer " + a + " · email",
    email_readback: (a: string, d: string) => "Email reply to " + a + ": “" + d + "”. Send it?",
    enquiries: (n: number) => n + (n === 1 ? " enquiry waiting" : " enquiries waiting"),
  },
} as const;

function clip(s: string, n: number) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

const EMAIL_CARD_CATEGORIES = ["enquiry", "booking_change", "other"];

function readLine(f: any, due: string | null): string | null {
  if (due) return "deadline " + due;
  if (!f || typeof f !== "object") return null;
  const parts: string[] = [];
  if (f.date) parts.push(String(f.date));
  if (f.pax) parts.push(f.pax + " pax");
  if (f.budget_pp) parts.push("~" + f.budget_pp + " €/pp");
  if (f.venue_case) parts.push(f.venue_case === "ours" ? "at ours" : f.venue_case === "provider" ? "their venue" : String(f.venue_case));
  if (f.food_shape) parts.push(String(f.food_shape));
  return parts.length ? parts.join(" · ") : null;
}

async function listWaitingSocial(sb: SupabaseClient, entityId: string, who?: string): Promise<{ items: WaitingItem[]; total: number }> {
  let q = sb.from("social_comments")
    .select("id, platform, author_handle, author_name, text, draft_reply, flagged, flag_reason, media_permalink, created_at_remote", { count: "exact" })
    .eq("entity_id", entityId).in("status", ["new", "drafted"])
    .order("created_at_remote", { ascending: true, nullsFirst: false });
  if (who) {
    const w = "%" + who.trim().replace(/^@/, "") + "%";
    q = q.or("author_handle.ilike." + w + ",author_name.ilike." + w);
  }
  const { data, count } = await q.limit(50);
  const items = (data || []).map((r: any): WaitingItem => ({
    id: r.id, kind: "comment", platform: r.platform || null,
    author: r.author_handle ? "@" + String(r.author_handle).replace(/^@/, "") : (r.author_name || (r.platform || "?")),
    text: r.text || "", draft: r.draft_reply || null, flagged: !!r.flagged, flag_reason: r.flag_reason || null,
    permalink: r.media_permalink || null, created_at_remote: r.created_at_remote || null,
  }));
  return { items, total: Number(count || 0) };
}

// Email threads waiting for Boris: sorted, drafted (or card-only), not noise,
// not captured, not flagged-for-him (fiscal/legal is never read back by Chef —
// he writes those on the page). Oldest first: the enquiry clock is running.
async function listWaitingEmail(sb: SupabaseClient, entityId: string, who?: string, house?: string | null): Promise<{ items: WaitingItem[]; total: number }> {
  let q = sb.from("email_threads")
    .select("id, subject, snippet, from_address, from_name, draft_reply, draft_lang, flagged, flag_reason, category, confidence, enquiry_fields, needs_you_due, first_received_at, status", { count: "exact" })
    .eq("entity_id", entityId).in("status", ["classified", "drafted"]).eq("flagged", false).in("category", EMAIL_CARD_CATEGORIES)
    .order("first_received_at", { ascending: true, nullsFirst: false });
  if (who) {
    const w = "%" + who.trim().replace(/^@/, "") + "%";
    q = q.or("from_name.ilike." + w + ",from_address.ilike." + w + ",subject.ilike." + w);
  }
  const { data, count, error } = await q.limit(50);
  if (error) return { items: [], total: 0 };   // table absent on an old branch → no email cards, no crash
  const href = house ? "/h/" + house + "/comms?channel=email" : null;
  const items = (data || []).map((r: any): WaitingItem => ({
    id: r.id, kind: "email", platform: "email",
    author: r.from_name || r.from_address || "?",
    text: [r.subject, r.snippet].filter(Boolean).join(" — "), draft: r.draft_reply || null,
    flagged: !!r.flagged, flag_reason: r.flag_reason || null, permalink: href, created_at_remote: r.first_received_at || null,
    subject: r.subject || null, category: r.category || null, read: readLine(r.enquiry_fields, r.needs_you_due || null),
  }));
  return { items, total: Number(count || 0) };
}

export async function listWaiting(sb: SupabaseClient, entityId: string, opts?: { exclude?: string[]; who?: string; limit?: number; channel?: InboxChannel; house?: string | null }): Promise<{ items: WaitingItem[]; total: number }> {
  const channel = opts?.channel || "all";
  const [social, email] = await Promise.all([
    channel === "email" ? Promise.resolve({ items: [] as WaitingItem[], total: 0 }) : listWaitingSocial(sb, entityId, opts?.who),
    channel === "social" ? Promise.resolve({ items: [] as WaitingItem[], total: 0 }) : listWaitingEmail(sb, entityId, opts?.who, opts?.house),
  ]);
  const exclude = new Set(opts?.exclude || []);
  // Email first (a person is waiting for an answer with a date on it), then comments; each oldest first.
  const items = [...email.items, ...social.items].filter((r) => !exclude.has(r.id)).slice(0, opts?.limit || 50);
  return { items, total: email.total + social.total };
}

// Idle chip (predict.ts): how many sales enquiries wait for an answer.
export async function countEnquiriesWaiting(sb: SupabaseClient, entityId: string): Promise<number> {
  const { count, error } = await sb.from("email_threads").select("id", { count: "exact", head: true })
    .eq("entity_id", entityId).eq("category", "enquiry").in("status", ["classified", "drafted"]).eq("flagged", false);
  return error ? 0 : Number(count || 0);
}

export type InboxTurnPiece = {
  card: ChefCard; say: string; readback?: string; action?: ChefAction; needs_confirm: boolean;
};

// The card for one waiting comment. `mode` "walk" = Send/Skip/Edit on the
// card (Send opens the read-back); "approve" = the turn itself IS the
// read-back for Send.
export function itemCard(item: WaitingItem, entityId: string, lang: ChefLang, entityLabel: string | undefined, remaining: number, mode: "walk" | "approve"): InboxTurnPiece {
  const s = S[lang];
  const isEmail = item.kind === "email";
  const title = isEmail ? s.answer(item.author) : s.reply_to(item.author) + (item.platform ? " · " + item.platform : "");
  const lines: string[] = [clip(item.text, 140)];
  if (isEmail && item.read) lines.push(item.read);
  if (item.flagged) lines.push(s.flagged(item.flag_reason || "—"));
  if (item.draft) lines.push("↩ " + clip(item.draft, 160)); else if (!item.flagged) lines.push(s.no_draft);
  if (remaining > 0) lines.push(s.left(remaining));
  const sendAction: ChefAction | null = item.draft
    ? (isEmail
      ? { type: "approve_email", entity_id: entityId, id: item.id, text: item.draft, author: item.author }
      : { type: "approve_reply", entity_id: entityId, kind: "comment", id: item.id, text: item.draft, author: item.author })
    : null;
  const readback = item.draft ? (isEmail ? s.email_readback(item.author, clip(item.draft, 240)) : s.readback(item.author, clip(item.draft, 240))) : undefined;
  const skipAction: ChefAction = isEmail
    ? { type: "skip_email", entity_id: entityId, id: item.id, author: item.author }
    : { type: "skip_comment", entity_id: entityId, id: item.id, author: item.author };
  const card: ChefCard = {
    title, lines: lines.slice(0, 4), kind: mode === "approve" ? "confirm" : "read", entity_label: entityLabel,
    href: item.permalink || undefined, persist: true,
    primary: sendAction ? { label: s.send, kind: "confirm", action: sendAction, readback: readback! } : { label: s.next, kind: "turn", message: "#inbox_next" },
    chip: { label: s.skip, kind: "act", action: skipAction },
    secondary: { label: s.edit, kind: "edit_reply", id: item.id, author: item.author, draft: item.draft || "", channel: isEmail ? "email" : "social" },
  };
  const say = isEmail
    ? (lang === "es"
      ? "Email de " + item.author + ": " + clip(item.subject || item.text, 80) + (item.read ? ". " + item.read : "") + (item.draft ? ". Propongo: " + clip(item.draft, 120) : "")
      : "Email from " + item.author + ": " + clip(item.subject || item.text, 80) + (item.read ? ". " + item.read : "") + (item.draft ? ". Draft: " + clip(item.draft, 120) : ""))
    : (lang === "es"
      ? item.author + " dice: " + clip(item.text, 80) + (item.draft ? ". Propongo: " + clip(item.draft, 120) : "")
      : item.author + " says: " + clip(item.text, 80) + (item.draft ? ". Draft: " + clip(item.draft, 120) : ""));
  if (mode === "approve" && sendAction) return { card, say: readback || say, readback, action: sendAction, needs_confirm: true };
  return { card, say, needs_confirm: false };
}

export function emptyCard(lang: ChefLang, entityLabel: string | undefined, href: string): InboxTurnPiece {
  const s = S[lang];
  return { card: { title: s.none, lines: [], kind: "read", entity_label: entityLabel, href }, say: s.none, needs_confirm: false };
}

export function whoCard(lang: ChefLang, who: string, n: number, entityLabel: string | undefined, channel: InboxChannel = "all"): InboxTurnPiece {
  const s = S[lang];
  const title = channel === "email" ? (n === 0 ? s.email_not_found(who) : s.email_many(who, n)) : (n === 0 ? s.not_found(who) : s.many(who, n));
  return { card: { title, lines: [], kind: "read", entity_label: entityLabel }, say: title, needs_confirm: false };
}
