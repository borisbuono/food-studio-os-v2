// lib/email/accounts.ts — connected mailboxes as rows. Server-only.
//
// Tokens never leave Vault through a table read: the service client calls the
// definer RPCs email_account_tokens / email_account_set_access. Interactive
// callers (connect / disconnect / manual pull) pass requireManagerOf() first;
// the poller runs with the Vault-minted email_inbox_secret.

import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailError, refreshAccessToken } from "@/lib/email/gmail";
import { googleClientFor, sameClient } from "@/lib/google/oauthClient";

export type EmailAccount = {
  id: string; entity_id: string; address: string; display_name: string | null; status: string;
  forwards_to_holded: boolean; history_id: string | null; token_expires_at: string | null;
  connected_by: string | null; last_pull_at: string | null; last_error: string | null; consecutive_failures: number;
  oauth_client_id?: string | null;   // Google client that minted the tokens (null = before 2026-10-03)
};
const COLS = "id, entity_id, address, display_name, status, forwards_to_holded, history_id, token_expires_at, connected_by, last_pull_at, last_error, consecutive_failures, oauth_client_id";

export async function loadActiveAccounts(svc: SupabaseClient, onlyId?: string | null, entityId?: string | null): Promise<EmailAccount[]> {
  let q = svc.from("email_accounts").select(COLS).is("revoked_at", null).in("status", ["active", "needs_reconnect"]);
  if (onlyId) q = q.eq("id", onlyId);
  if (entityId) q = q.eq("entity_id", entityId);
  const { data, error } = await q.order("connected_at");
  if (error) throw new Error(error.message);
  return (data || []) as EmailAccount[];
}

export async function loadAccount(svc: SupabaseClient, id: string): Promise<EmailAccount | null> {
  const { data } = await svc.from("email_accounts").select(COLS).eq("id", id).is("revoked_at", null).maybeSingle();
  return (data as EmailAccount | null) || null;
}

// A usable access token for the mailbox: the stored one if it has >2 min
// left, else a refresh written back through the RPC. Throws GmailError
// 'invalid_grant' when Google says we are no longer authorised — the caller
// flips the row to needs_reconnect.
//
// The refresh uses the HOUSE's Google client (oauth_clients row; env pair
// only for rows minted before 2026-10-03). A refresh token is bound to the
// client that minted it, so if the house's client was replaced since, the
// row needs a reconnect — say so ('client_changed') instead of letting Google
// answer invalid_client.
const cache = new Map<string, { token: string; exp: number }>();
export async function accessTokenFor(svc: SupabaseClient, account: EmailAccount): Promise<string> {
  const c = cache.get(account.id);
  if (c && c.exp > Date.now() + 120_000) return c.token;
  const { data, error } = await svc.rpc("email_account_tokens", { p_account_id: account.id });
  if (error) throw new Error(`email_account_tokens: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { access_token: string | null; refresh_token: string | null; token_expires_at: string | null } | undefined;
  if (!row?.refresh_token) throw new GmailError(503, "no refresh token on file — reconnect the mailbox", "no_refresh_token");
  const exp = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (row.access_token && exp > Date.now() + 120_000) {
    cache.set(account.id, { token: row.access_token, exp });
    return row.access_token;
  }
  const client = await googleClientFor(svc, account.entity_id, { allowEnv: !account.oauth_client_id });
  if (!client) throw new GmailError(503, "no Google client for this house — set it on Comms › Mail", "client_not_set");
  if (!sameClient(account.oauth_client_id, client)) throw new GmailError(401, "the house's Google client changed since this mailbox was connected — reconnect it", "client_changed");
  const fresh = await refreshAccessToken(row.refresh_token, client);
  await svc.rpc("email_account_set_access", { p_account_id: account.id, p_access_token: fresh.access_token, p_expires_at: fresh.expires_at });
  cache.set(account.id, { token: fresh.access_token, exp: Date.parse(fresh.expires_at) });
  return fresh.access_token;
}

export async function markAccountError(svc: SupabaseClient, account: EmailAccount, err: unknown): Promise<void> {
  const e = err as any;
  const msg = String(e?.message || e).slice(0, 400);
  const reconnect = e instanceof GmailError && (e.reason === "invalid_grant" || e.reason === "no_refresh_token" || e.reason === "client_changed" || e.status === 401);
  await svc.from("email_accounts").update({
    last_error: msg, consecutive_failures: (account.consecutive_failures || 0) + 1,
    ...(reconnect ? { status: "needs_reconnect" } : {}),
  }).eq("id", account.id);
}

export async function markAccountOk(svc: SupabaseClient, account: EmailAccount, historyId: string | null): Promise<void> {
  await svc.from("email_accounts").update({
    last_error: null, consecutive_failures: 0, last_pull_at: new Date().toISOString(), status: "active",
    ...(historyId ? { history_id: historyId } : {}),
  }).eq("id", account.id);
}
