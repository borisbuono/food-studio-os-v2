import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";
import { gcalRedirectUri, syncPerson, type GcalTokens } from "@/lib/calendarGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Google lands here with ?code&state. Exchange → store via gcal_save_tokens
// (as the signed-in user) → first pull → back to /me/calendar.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string) => Response.redirect(`${url.origin}/me/calendar?google=${encodeURIComponent(msg)}`, 302);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = cookies();
  const expected = jar.get("fs_gcal_state")?.value;
  try { jar.delete("fs_gcal_state"); } catch { /* ignore */ }
  if (url.searchParams.get("error")) return back(`denied:${url.searchParams.get("error")}`);
  if (!code || !state || !expected || state !== expected) return back("state_mismatch");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.redirect(`${url.origin}/login?next=/me/calendar`, 302);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      redirect_uri: gcalRedirectUri(url.origin), grant_type: "authorization_code",
    }),
  });
  const tok: any = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) return back(`token_${r.status}`);

  let email: string | null = null;
  try {
    const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } });
    email = ((await ui.json()) as any)?.email || null;
  } catch { /* optional */ }

  const expires = new Date(Date.now() + (Number(tok.expires_in) || 3000) * 1000).toISOString();
  const { data: pid, error } = await sb.rpc("gcal_save_tokens", {
    p_refresh: tok.refresh_token || "", p_access: tok.access_token, p_expires: expires,
    p_scopes: String(tok.scope || "").split(" ").filter(Boolean), p_email: email,
  });
  if (error || !pid) return back(error?.code === "42501" ? "no_team_member" : "save_failed");

  const { data: rows } = await sb.rpc("gcal_my_tokens");
  const t = ((rows as any[]) || [])[0] as GcalTokens | undefined;
  if (!t?.refresh_token) return back("no_refresh_token");
  const res = await syncPerson(sb as any, t);
  return back(res.ok ? "connected" : "connected_sync_failed");
}
