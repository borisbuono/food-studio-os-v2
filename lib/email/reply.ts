// lib/email/reply.ts — the OS side of the ONE send path for email. Server-only.
//
// Nothing here sends and nothing here writes approved_by_boris. Both happen
// inside the edge function email-reply (supabase/functions/email-reply), which
// refuses (403) unless the chef_confirm_tokens row behind the tap / spoken yes
// / inbox tick has been CONSUMED for this user and this exact action. This
// module only:
//   1. shapes the canonical ChefAction  {type:"approve_email", entity_id, id, text}
//      that the token is minted and consumed against;
//   2. refreshes the mailbox access token through the Vault RPCs (the Google
//      client secret lives in Vercel, E1 decision) so the edge function finds a
//      live token;
//   3. calls email-reply with the service-role key and maps its answer.
//
// Callers: /api/email/act (page tick → mintAndConsumePageTick) and
// /api/chef/act (read-back → consumeConfirmToken). Both consume first, then call.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefAction } from "@/lib/chef/types";
import { accessTokenFor, loadAccount, markAccountError } from "@/lib/email/accounts";
import { advanceLead } from "@/lib/email/funnel";

export type ApproveEmailAction = Extract<ChefAction, { type: "approve_email" }>;

export function approveEmailAction(entityId: string, threadId: string, text: string, author?: string | null): ApproveEmailAction {
  const a: ApproveEmailAction = { type: "approve_email", entity_id: entityId, id: threadId, text: String(text || "").trim() };
  if (author) a.author = author;
  return a;
}

// Who the reply goes to and how it threads — pure, tested. The last INBOUND
// message decides: never reply to ourselves, never to a cc list.
export function replyTarget(thread: { from_address: string | null }, lastIn: { from_address: string | null; message_id_header: string | null; references_header: string | null } | null) {
  const to = String(lastIn?.from_address || thread.from_address || "").toLowerCase();
  const inReplyTo = lastIn?.message_id_header || null;
  const references = inReplyTo ? [lastIn?.references_header, inReplyTo].filter(Boolean).join(" ") : null;
  return { to: to || null, inReplyTo, references };
}

export type SendEmailResult = {
  ok: boolean; status: "replied" | "failed" | "error"; error: string | null; http: number;
  gmail_message_id?: string | null; hours_to_answer?: number | null; dry_run?: boolean; would_send?: Record<string, unknown> | null; reason?: string | null;
};

export async function callEmailReply(payload: Record<string, unknown>): Promise<{ http: number; body: any }> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/email-reply`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return { http: 503, body: { ok: false, error: "no service key on this deployment — email-reply needs SUPABASE_SERVICE_ROLE_KEY" } };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({}));
  return { http: r.status, body };
}

// The send, for a caller that has ALREADY consumed the confirm token for `action`.
export async function sendEmailReply(svc: SupabaseClient, o: {
  threadId: string; accountId: string; text: string; uid: string; confirmToken: string; action: ApproveEmailAction; via: "tap" | "voice" | "page_tick"; dryRun?: boolean;
}): Promise<SendEmailResult> {
  if (!o.confirmToken) return { ok: false, status: "error", error: "not_confirmed", http: 403, reason: "missing" };
  if (!o.text.trim()) return { ok: false, status: "error", error: "empty reply", http: 422 };
  // Keep the mailbox token live so the edge function (no Google secret) can send.
  if (!o.dryRun) {
    const acc = await loadAccount(svc, o.accountId);
    if (!acc) return { ok: false, status: "error", error: "mailbox not connected", http: 503 };
    try { await accessTokenFor(svc, acc); }
    catch (e) { await markAccountError(svc, acc, e); return { ok: false, status: "error", error: `mailbox token: ${String((e as any)?.message || e)}`, http: 503 }; }
  }
  const r = await callEmailReply({ id: o.threadId, text: o.text, confirm_token: o.confirmToken, user_id: o.uid, action: o.action, via: o.via, dry_run: !!o.dryRun });
  const ok = r.http === 200 && r.body?.ok !== false;
  // E5: a sent reply moves the funnel row to 'contacted' (Chef and page alike)
  if (ok && !o.dryRun) { try { await advanceLead(svc, o.threadId, "replied"); } catch { /* optional */ } }
  if (o.dryRun) return { ok, status: ok ? "replied" : "error", error: ok ? null : (r.body?.detail || r.body?.error || `email-reply ${r.http}`), http: r.http, dry_run: true, would_send: r.body?.would_send ?? null, reason: r.body?.reason ?? null };
  return {
    ok, status: ok ? "replied" : "failed",
    error: ok ? null : (r.body?.detail || r.body?.error || `email-reply ${r.http}`),
    http: ok ? 200 : (r.http === 403 ? 403 : 502), reason: r.body?.reason ?? null,
    gmail_message_id: r.body?.gmail_message_id ?? null, hours_to_answer: r.body?.hours_to_answer ?? null,
  };
}
