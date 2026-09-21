import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";
import { GCAL_SCOPES, gcalRedirectUri } from "@/lib/calendarGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calendar/google/start → Google consent (calendar.readonly).
// Anti-CSRF state in a short-lived httpOnly cookie, checked by the callback.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.redirect(`${url.origin}/login?next=/me/calendar`, 302);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return Response.json({ ok: false, error: "GOOGLE_OAUTH_CLIENT_ID not configured" }, { status: 500 });
  const state = crypto.randomUUID();
  cookies().set("fs_gcal_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/calendar/google", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gcalRedirectUri(url.origin),
    response_type: "code",
    scope: GCAL_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
