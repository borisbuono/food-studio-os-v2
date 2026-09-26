// The ONE approve path for social replies, shared by /api/inbox/act (the
// inbox page tick) and /api/chef/act (Chef's "send the reply to …").
//
// Slice A (2026-09-26): approveAndSend no longer flips approved_by_boris on
// its own. That column is written ONLY by confirmApproval(), which every
// caller reaches after a confirm token has been consumed (Chef: the
// read-back gate; inbox page: mintAndConsumePageTick). meta-reply still
// refuses (403 not_approved) unless the row carries approved_by_boris, so a
// row nobody confirmed cannot leave the account.

import type { SupabaseClient } from "@supabase/supabase-js";

export type InboxKind = "comment" | "dm";
export const INBOX_TABLE: Record<InboxKind, string> = { comment: "social_comments", dm: "social_dm_messages" };

export async function callMetaReply(payload: Record<string, unknown>) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/meta-reply`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  return { http: r.status, body };
}

export type ApproveResult = { ok: boolean; status: "replied" | "failed" | "error"; error: string | null; reply_remote_id: string | null; http: number };

// Step 1 — the confirm path. Writes approved_by_boris through the caller's
// RLS-bound client (so nobody who couldn't tick the row on the inbox page
// can make Chef send it either). `confirm_token` is the consumed token that
// proves the gate ran; it is recorded on the row for the audit trail.
export async function confirmApproval(
  sb: SupabaseClient, kind: InboxKind, id: string, text: string, uid: string, confirmToken: string,
): Promise<{ ok: true } | { ok: false; error: string; http: number }> {
  const table = INBOX_TABLE[kind];
  const t = String(text || "").trim();
  if (!t) return { ok: false, error: "empty reply", http: 422 };
  if (!confirmToken) return { ok: false, error: "not_confirmed", http: 403 };
  const { data: row } = await sb.from(table).select("id, status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found", http: 404 };
  if ((row as any).status === "replied") return { ok: false, error: "already replied", http: 409 };
  const now = new Date().toISOString();
  const { error } = await sb.from(table).update({
    reply_text: t, approved_by_boris: true, approved_at: now, approved_by_user: uid, status: "approved", error: null,
  }).eq("id", id);
  if (error) return { ok: false, error: `approve: ${error.message}`, http: 403 };
  return { ok: true };
}

// Step 2 — the send. meta-reply re-checks approved_by_boris on the row.
export async function sendApproved(kind: InboxKind, id: string): Promise<ApproveResult> {
  const r = await callMetaReply({ kind, id });
  const ok = r.http === 200 && r.body?.ok !== false;
  return {
    ok, status: ok ? "replied" : "failed",
    error: ok ? null : (r.body?.detail || r.body?.error || `meta-reply ${r.http}`),
    reply_remote_id: r.body?.reply_remote_id ?? null, http: ok ? 200 : 502,
  };
}

// Both steps, for a caller that has ALREADY consumed a confirm token.
export async function approveAndSend(
  sb: SupabaseClient, kind: InboxKind, id: string, text: string, uid: string, confirmToken: string,
): Promise<ApproveResult> {
  const a = await confirmApproval(sb, kind, id, text, uid, confirmToken);
  if (!a.ok) return { ok: false, status: "error", error: a.error, reply_remote_id: null, http: a.http };
  return sendApproved(kind, id);
}
