import { supabaseServer } from "@/lib/supabaseServer";
import { persistAuthForChannel, testGmailAccessToken } from "@/lib/assistant/channels/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/assistant/channels/gmail/callback?code=...&state=...
// Google's OAuth landing point. Exchanges the auth code for tokens, stores
// them in the vault, and creates the assistant_channels row.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const err = url.searchParams.get("error");
  if (err) return htmlBack(`Google returned an error: ${err}. Close this tab and try again.`, "/administrate/settings/assistant");
  if (!code || !state) return htmlBack("Missing code or state.", "/administrate/settings/assistant");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return htmlBack("Sign in first, then reconnect Gmail.", "/administrate/settings/assistant");

  // Recover the pending OAuth intent (entity + return path) — most recent
  // gmail.oauth.start row for this user with a matching state.
  const { data: pending } = await sb.from("assistant_actions")
    .select("id,payload,created_at")
    .eq("user_id", u.user.id)
    .eq("action_type", "gmail.oauth.start")
    .order("created_at", { ascending: false })
    .limit(20);
  const match = (pending || []).find((r: any) => (r.payload as any)?.state === state) as any;
  if (!match) return htmlBack("Auth state expired. Please start the connection from Assistant Settings again.", "/administrate/settings/assistant");
  const entity = (match.payload?.entity || "IFL") as "IFL" | "BM" | "BBH";
  const returnTo = String(match.payload?.return || "/administrate/settings/assistant");
  const redirectUri = String(match.payload?.redirect_uri || (url.origin + "/api/assistant/channels/gmail/callback"));

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return htmlBack("GOOGLE_OAUTH_CLIENT_ID / _SECRET not configured on server.", returnTo);

  // Exchange the code for tokens.
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const tok = await r.json().catch(() => ({} as any));
  if (!r.ok || !tok.access_token) {
    return htmlBack(`Google token exchange ${r.status}: ${JSON.stringify(tok).slice(0, 200)}`, returnTo);
  }
  const refresh_token = String(tok.refresh_token || "");
  if (!refresh_token) return htmlBack("Google didn't return a refresh token — revoke the app in your Google Account and try again with prompt=consent.", returnTo);

  // Probe /users/me/profile to get the operator's email.
  const probe = await testGmailAccessToken(tok.access_token);
  if (!probe.ok || !probe.email) return htmlBack(`Gmail probe failed: ${probe.error || "no email returned"}`, returnTo);
  const email = probe.email;

  // Persist the auth into the vault, then create the assistant_channels row.
  let authRef: string;
  try {
    authRef = await persistAuthForChannel({
      userId: u.user.id,
      entity,
      email,
      auth: {
        refresh_token,
        access_token: tok.access_token,
        access_token_expires_at: Math.floor(Date.now() / 1000) + Number(tok.expires_in || 3600),
        scope: tok.scope || null,
        token_type: tok.token_type || "Bearer",
      },
    });
  } catch (e: any) {
    return htmlBack("Vault write failed: " + (e?.message || "unknown"), returnTo);
  }

  // Revoke prior gmail channels for this user + email, then insert the new
  // one. Draft-first is the default (auto_send=false).
  await sb.from("assistant_channels").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", u.user.id).eq("channel_type", "gmail").eq("account_ref", email).is("revoked_at", null);
  const { data: chan } = await sb.from("assistant_channels").insert({
    user_id: u.user.id,
    channel_type: "gmail",
    account_ref: email,
    auth_ref: authRef,
    settings: { triage_enabled: true, auto_draft: true, auto_send: false, supervised_send: false, entity_code: entity },
  }).select("id").maybeSingle();

  await sb.from("assistant_actions").insert({
    user_id: u.user.id,
    action_type: "gmail.oauth.complete",
    target_table: "assistant_channels",
    target_id: chan?.id || null,
    payload: { entity, email, auth_ref: authRef },
    reversible: true,
  });

  const back = returnTo.startsWith("/") ? returnTo : "/administrate/settings/assistant";
  return htmlBack(`Gmail connected as ${email}. You can close this tab.`, back + "?gmail=connected");
}

function htmlBack(message: string, returnTo: string) {
  const safe = message.replace(/</g, "&lt;");
  const target = returnTo.replace(/"/g, "");
  const body = `<!doctype html><meta charset="utf-8"><title>Gmail</title>
<style>body{font-family:ui-serif,Georgia,serif;background:#F4EFE7;color:#211E1B;margin:0;padding:64px 24px;text-align:center}
.k{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#9C9282}
.m{margin-top:12px;font-size:18px;line-height:1.5}
a{margin-top:24px;display:inline-block;color:#B5701C;text-decoration:none;border-bottom:1px solid currentColor}</style>
<p class="k">Assistant · Gmail</p>
<p class="m">${safe}</p>
<a href="${target}">← Back to Assistant Settings</a>
<script>setTimeout(()=>{try{window.location.replace(${JSON.stringify(target)});}catch{}},1600);</script>`;
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
