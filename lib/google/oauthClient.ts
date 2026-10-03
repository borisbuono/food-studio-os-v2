// lib/google/oauthClient.ts — WHICH Google OAuth client a house uses. Server-only.
//
// Boris ruled 2026-10-03: Google credentials are per entity. The Google app is
// Internal, so there is one OAuth client per Workspace (ibzfoodstudio.com →
// Taller / Holdings; bistro-mondo.com → Bistro Mondo) and an Internal client
// only admits its own org's users. The pair lives as a ROW in oauth_clients
// (secret in Vault), pasted by a manager on Comms › Mail — never typed by
// automation, never a code edit.
//
//   googleClientFor(svc, entityId, { allowEnv })
//     → the entity's active client via fn_oauth_client_for (service_role RPC),
//       else — only when allowEnv — the legacy GOOGLE_OAUTH_CLIENT_ID/_SECRET
//       pair from Vercel env, else null.
//
// allowEnv is TRUE on the token-refresh path (a mailbox minted before this
// change, or the calendar connector, keeps working) and FALSE on the email
// connect path: the env client is the Supabase sign-in app and must never be
// sent to Gmail consent (memory email_google_oauth_2026-10-03). "Google client
// not set for this house" is a clean state the UI shows, not an error.
//
// pickGoogleClient / sameClient / googleConsentParams are pure and tested in
// tests/email-channel.test.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleOAuthClient = {
  client_id: string;
  client_secret: string;
  hosted_domain: string | null;
  source: "entity" | "env";
};

export type OAuthClientRow = { client_id: string | null; client_secret: string | null; hosted_domain: string | null; status?: string | null } | null | undefined;
export type EnvPair = { id?: string | null; secret?: string | null };

// Pure: row beats env; env only when allowed and complete.
export function pickGoogleClient(row: OAuthClientRow, env: EnvPair, opts: { allowEnv: boolean }): GoogleOAuthClient | null {
  if (row?.client_id && row.client_secret && (row.status ?? "active") === "active") {
    return { client_id: row.client_id, client_secret: row.client_secret, hosted_domain: row.hosted_domain || null, source: "entity" };
  }
  if (opts.allowEnv && env.id && env.secret) return { client_id: env.id, client_secret: env.secret, hosted_domain: null, source: "env" };
  return null;
}

// Pure: did this mailbox's tokens come from the client we are about to use?
// null minted = legacy row (before 2026-10-03) → trust whatever we have.
export function sameClient(mintedClientId: string | null | undefined, client: Pick<GoogleOAuthClient, "client_id">): boolean {
  return !mintedClientId || mintedClientId === client.client_id;
}

// Pure: the consent URL params. `hd` is Google's hosted-domain hint — the
// account picker pre-filters to that Workspace (it is a hint, not a gate; the
// Internal client is the gate).
export function googleConsentParams(a: { client: Pick<GoogleOAuthClient, "client_id" | "hosted_domain">; redirectUri: string; scopes: string[]; state: string; prompt?: string }): URLSearchParams {
  const p = new URLSearchParams({
    client_id: a.client.client_id,
    redirect_uri: a.redirectUri,
    response_type: "code",
    scope: a.scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: a.prompt || "consent select_account",
    state: a.state,
  });
  if (a.client.hosted_domain) p.set("hd", a.client.hosted_domain);
  return p;
}

export function envGooglePair(): EnvPair {
  return { id: process.env.GOOGLE_OAUTH_CLIENT_ID || null, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || null };
}

// The entity's client, secret included. `svc` MUST be a service-role client —
// fn_oauth_client_for refuses anything else.
export async function googleClientFor(svc: SupabaseClient, entityId: string, opts: { allowEnv: boolean }): Promise<GoogleOAuthClient | null> {
  const { data, error } = await svc.rpc("fn_oauth_client_for", { p_entity_id: entityId, p_provider: "google" });
  if (error) throw new Error(`fn_oauth_client_for: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as OAuthClientRow;
  return pickGoogleClient(row, envGooglePair(), opts);
}

// What the UI may know: id, hosted domain, status, when — never the secret.
// Read through the signed-in user's client so RLS (manager of the entity)
// decides; a non-manager simply sees null.
export type OAuthClientPublic = { client_id: string; hosted_domain: string | null; status: "active" | "disabled"; created_at: string; updated_at: string };
export async function googleClientPublic(sb: SupabaseClient, entityId: string): Promise<OAuthClientPublic | null> {
  const { data } = await sb.from("oauth_clients").select("client_id, hosted_domain, status, created_at, updated_at")
    .eq("entity_id", entityId).eq("provider", "google").maybeSingle();
  return (data as OAuthClientPublic | null) || null;
}

// "313770957352-8gli…" — enough to tell two clients apart, never the whole id in the UI.
export function clientIdPrefix(id: string): string {
  return id.length > 18 ? `${id.slice(0, 18)}…` : id;
}

// A Google OAuth client id has a fixed shape; refuse anything else at paste time.
export function looksLikeGoogleClientId(s: string): boolean {
  return /^\d{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/i.test(s.trim());
}
