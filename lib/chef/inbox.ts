// Chef v3 Phase 2 — the inbox, one card at a time. Server only.
//
// "cuántos comentarios esperan" is a count (Phase 1). "abre la bandeja" /
// "siguiente" walks the waiting comments one card at a time: the comment,
// the Haiku draft, and Send / Skip / Edit. Send is an outbound write, so it
// always goes through the read-back gate; the client never calls meta-reply
// itself — /api/chef/act does, through lib/social/inboxAct (the same gate
// the inbox page uses).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefAction, ChefCard, ChefLang } from "@/lib/chef/types";

export type WaitingItem = {
  id: string;
  kind: "comment";
  platform: string | null;
  author: string;
  text: string;
  draft: string | null;
  flagged: boolean;
  flag_reason: string | null;
  permalink: string | null;
  created_at_remote: string | null;
};

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
  },
} as const;

function clip(s: string, n: number) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export async function listWaiting(sb: SupabaseClient, entityId: string, opts?: { exclude?: string[]; who?: string; limit?: number }): Promise<{ items: WaitingItem[]; total: number }> {
  let q = sb.from("social_comments")
    .select("id, platform, author_handle, author_name, text, draft_reply, flagged, flag_reason, media_permalink, created_at_remote", { count: "exact" })
    .eq("entity_id", entityId).in("status", ["new", "drafted"])
    .order("created_at_remote", { ascending: true, nullsFirst: false });
  if (opts?.who) {
    const w = "%" + opts.who.trim().replace(/^@/, "") + "%";
    q = q.or("author_handle.ilike." + w + ",author_name.ilike." + w);
  }
  const { data, count } = await q.limit(50);
  const exclude = new Set(opts?.exclude || []);
  const items = (data || []).filter((r: any) => !exclude.has(r.id)).slice(0, opts?.limit || 50).map((r: any): WaitingItem => ({
    id: r.id, kind: "comment", platform: r.platform || null,
    author: r.author_handle ? "@" + String(r.author_handle).replace(/^@/, "") : (r.author_name || (r.platform || "?")),
    text: r.text || "", draft: r.draft_reply || null, flagged: !!r.flagged, flag_reason: r.flag_reason || null,
    permalink: r.media_permalink || null, created_at_remote: r.created_at_remote || null,
  }));
  return { items, total: Number(count || 0) };
}

export type InboxTurnPiece = {
  card: ChefCard; say: string; readback?: string; action?: ChefAction; needs_confirm: boolean;
};

// The card for one waiting comment. `mode` "walk" = Send/Skip/Edit on the
// card (Send opens the read-back); "approve" = the turn itself IS the
// read-back for Send.
export function itemCard(item: WaitingItem, entityId: string, lang: ChefLang, entityLabel: string | undefined, remaining: number, mode: "walk" | "approve"): InboxTurnPiece {
  const s = S[lang];
  const title = s.reply_to(item.author) + (item.platform ? " · " + item.platform : "");
  const lines: string[] = [clip(item.text, 140)];
  if (item.flagged) lines.push(s.flagged(item.flag_reason || "—"));
  if (item.draft) lines.push("↩ " + clip(item.draft, 160)); else if (!item.flagged) lines.push(s.no_draft);
  if (remaining > 0) lines.push(s.left(remaining));
  const sendAction: ChefAction | null = item.draft ? { type: "approve_reply", entity_id: entityId, kind: "comment", id: item.id, text: item.draft, author: item.author } : null;
  const readback = item.draft ? s.readback(item.author, clip(item.draft, 240)) : undefined;
  const skipAction: ChefAction = { type: "skip_comment", entity_id: entityId, id: item.id, author: item.author };
  const card: ChefCard = {
    title, lines: lines.slice(0, 4), kind: mode === "approve" ? "confirm" : "read", entity_label: entityLabel,
    href: item.permalink || undefined, persist: true,
    primary: sendAction ? { label: s.send, kind: "confirm", action: sendAction, readback: readback! } : { label: s.next, kind: "turn", message: "#inbox_next" },
    chip: { label: s.skip, kind: "act", action: skipAction },
    secondary: { label: s.edit, kind: "edit_reply", id: item.id, author: item.author, draft: item.draft || "" },
  };
  const say = lang === "es"
    ? item.author + " dice: " + clip(item.text, 80) + (item.draft ? ". Propongo: " + clip(item.draft, 120) : "")
    : item.author + " says: " + clip(item.text, 80) + (item.draft ? ". Draft: " + clip(item.draft, 120) : "");
  if (mode === "approve" && sendAction) return { card, say: readback || say, readback, action: sendAction, needs_confirm: true };
  return { card, say, needs_confirm: false };
}

export function emptyCard(lang: ChefLang, entityLabel: string | undefined, href: string): InboxTurnPiece {
  const s = S[lang];
  return { card: { title: s.none, lines: [], kind: "read", entity_label: entityLabel, href }, say: s.none, needs_confirm: false };
}

export function whoCard(lang: ChefLang, who: string, n: number, entityLabel: string | undefined): InboxTurnPiece {
  const s = S[lang];
  const title = n === 0 ? s.not_found(who) : s.many(who, n);
  return { card: { title, lines: [], kind: "read", entity_label: entityLabel }, say: title, needs_confirm: false };
}
