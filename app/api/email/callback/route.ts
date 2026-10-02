import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { requireManagerOf } from "@/lib/access/requireManager";
import { emailRedirectUri } from "@/lib/email/gmail";
import { pullAll } from "@/lib/email/pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Google lands here with ?code&state. Consume the state row (one shot, 15 min),
// exchange the code, learn WHICH mailbox consented (userinfo), store the
// mailbox + tokens as rows via email_account_upsert (Vault), then run the first
// pull so the Mailboxes tab shows something at once.
//
// Public path in middleware (Google arrives without our cookie on some
// browsers); the signed-in check below still runs — if the session is gone we
// bounce to /login and the state row is already consumed, so the code dies.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const svc = supabaseService();
  const bounce = (back: string, msg: string) => NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}mail=${encodeURIComponent(msg)}`, 302);
  if (!svc) return bounce("/studio", "no_service_key");

  // consume the state first — one shot
  const { data: st } = await svc.from("email_oauth_states").update({ consumed_at: new Date().toISOString() })
    .eq("state", state).is("consumed_at", null).gt("expires_at", new Date().toISOString())
    .select("entity_id, redirect_to, created_by").maybeSingle();
  const back = (st as any)?.redirect_to || "/studio";
  if (!st) return bounce("/studio", "state_mismatch");
  if (url.searchParams.get("error")) return bounce(back, `denied:${url.searchParams.get("error")}`);
  if (!code) return bounce(back, "no_code");

  const sb = supabaseServer();
  const gate = await requireManagerOf(sb, (st as any).entity_id);
  if (!gate.ok) return gate.status === 401 ? NextResponse.redirect(`${url.origin}/login?next=${encodeURIComponent(back)}`, 302) : bounce(back, "forbidden");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      redirect_uri: emailRedirectUri(url.origin), grant_type: "authorization_code",
    }),
  });
  const tok: any = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) return bounce(back, `token_${r.status}${tok.error ? ":" + tok.error : ""}`);
  if (!tok.refresh_token) return bounce(back, "no_refresh_token");
  const scopes: string[] = String(tok.scope || "").split(" ").filter(Boolean);
  const need = ["gmail.readonly", "gmail.send", "gmail.modify"].filter((s) => !scopes.some((x) => x.endsWith("/" + s)));
  if (need.length) return bounce(back, `missing_scopes:${need.join(",")}`);

  let email: string | null = null, sub: string | null = null, name: string | null = null;
  try {
    const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } });
    const j: any = await ui.json();
    email = j?.email ? String(j.email).toLowerCase() : null; sub = j?.sub ? String(j.sub) : null; name = j?.name || null;
  } catch { /* fall through */ }
  if (!email) return bounce(back, "no_email");

  const expires = new Date(Date.now() + (Number(tok.expires_in) || 3000) * 1000).toISOString();
  const { data: accountId, error } = await svc.rpc("email_account_upsert", {
    p_entity_id: gate.entity_id, p_address: email, p_display_name: name, p_google_user_id: sub,
    p_scopes: scopes, p_access_token: tok.access_token, p_access_expires_at: expires, p_refresh_token: tok.refresh_token,
    p_connected_by: gate.uid,
  });
  if (error || !accountId) return bounce(back, "save_failed");

  // first pull now (best-effort; the 10-min poll continues)
  try { await pullAll(svc, "connect", { accountId: String(accountId) }); } catch { /* shown on the row */ }
  return bounce(back, `connected:${email}`);
}
