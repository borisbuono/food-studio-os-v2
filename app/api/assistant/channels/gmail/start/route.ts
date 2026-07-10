import { supabaseServer } from "@/lib/supabaseServer";
import { gmailScopeString } from "@/lib/assistant/channels/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/assistant/channels/gmail/start?entity=IFL[&return=/administrate/settings/assistant]
// Redirects to Google's OAuth consent screen. The callback lands at
// /api/assistant/channels/gmail/callback which stores tokens + creates the
// assistant_channels row.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = (url.searchParams.get("entity") || "IFL").toUpperCase();
  if (!["IFL", "BM", "BBH"].includes(entity)) {
    return Response.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
  }
  const returnTo = url.searchParams.get("return") || "/administrate/settings/assistant";

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "sign in first" }, { status: 401 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return Response.json({ ok: false, error: "GOOGLE_OAUTH_CLIENT_ID not configured on server" }, { status: 500 });
  }

  const origin = url.origin;
  const redirectUri = origin + "/api/assistant/channels/gmail/callback";

  // Random anti-CSRF state, remembered on the assistant_actions ledger so the
  // callback can verify it. Cheap + audit-visible.
  const state = (typeof crypto !== "undefined" && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  await sb.from("assistant_actions").insert({
    user_id: u.user.id,
    action_type: "gmail.oauth.start",
    target_table: "assistant_channels",
    payload: { entity, state, return: returnTo, redirect_uri: redirectUri },
    reversible: false,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailScopeString(),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}
