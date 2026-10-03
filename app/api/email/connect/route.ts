import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { requireManagerOf } from "@/lib/access/requireManager";
import { GMAIL_SCOPES, emailRedirectUri } from "@/lib/email/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/email/connect?entity=<slug|uuid>&back=/h/bm/comms?tab=mail
//
// Connect a mailbox to a house: the signed-in MANAGER of that entity is sent
// to Google consent for gmail.readonly + gmail.send + gmail.modify. The
// anti-CSRF state is a row in email_oauth_states (service only) bound to the
// entity, so the callback files the mailbox under the house that asked —
// never the session cookie. Two taps, no code edit (brief: a customer
// restaurant must be able to connect itself).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") || "";
  const back = url.searchParams.get("back") || "/studio";
  const sb = supabaseServer();
  const gate = await requireManagerOf(sb, entity);
  if (!gate.ok) {
    if (gate.status === 401) return NextResponse.redirect(`${url.origin}/login?next=${encodeURIComponent(back)}`, 302);
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}mail=not_configured`, 302);
  const svc = supabaseService();
  if (!svc) return NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}mail=no_service_key`, 302);

  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { error } = await svc.from("email_oauth_states").insert({ state, entity_id: gate.entity_id, redirect_to: back, created_by: gate.uid });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: emailRedirectUri(url.origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
