// The ONE approve path for social replies, shared by /api/inbox/act (the
// inbox page tick) and /api/chef/act (Chef's "send the reply to …").
//
// The gate stays inside the meta-reply edge function: it refuses (403
// not_approved) unless the row carries approved_by_boris. This helper only
// writes that flag through the caller's RLS-bound client — so nobody who
// couldn't tick the row on the inbox page can make Chef send it either.

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

// Marks the row approved (RLS decides) and asks meta-reply to send it.
export async function approveAndSend(sb: SupabaseClient, kind: InboxKind, id: string, text: string, uid: string): Promise<ApproveResult> {
  const table = INBOX_TABLE[kind];
  const t = String(text || "").trim();
  if (!t) return { ok: false, status: "error", error: "empty reply", reply_remote_id: null, http: 422 };
  const { data: row } = await sb.from(table).select("id, status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, status: "error", error: "not_found", reply_remote_id: null, http: 404 };
  if ((row as any).status === "replied") return { ok: false, status: "error", error: "already replied", reply_remote_id: null, http: 409 };
  const now = new Date().toISOString();
  const { error } = await sb.from(table).update({
    reply_text: t, approved_by_boris: true, approved_at: now, approved_by_user: uid, status: "approved", error: null,
  }).eq("id", id);
  if (error) return { ok: false, status: "error", error: `approve: ${error.message}`, reply_remote_id: null, http: 403 };
  const r = await callMetaReply({ kind, id });
  const ok = r.http === 200 && r.body?.ok !== false;
  return {
    ok, status: ok ? "replied" : "failed",
    error: ok ? null : (r.body?.detail || r.body?.error || `meta-reply ${r.http}`),
    reply_remote_id: r.body?.reply_remote_id ?? null, http: ok ? 200 : 502,
  };
}
