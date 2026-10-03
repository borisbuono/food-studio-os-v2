import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { requireManagerOf } from "@/lib/access/requireManager";
import { GMAIL_SCOPES, emailRedirectUri } from "@/lib/email/gmail";
import { googleClientFor, googleConsentParams } from "@/lib/google/oauthClient";

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
//
// 2026-10-03: the Google client is PER HOUSE (oauth_clients row, secret in
// Vault — Internal app = one client per Workspace). No row → back to the Mail
// tab with mail=client_not_set; the env pair is never used here (it is the
// Supabase sign-in client and must not be sent to Gmail consent).
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
  const svc = supabaseService();
  if (!svc) return NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}mail=no_service_key`, 302);
  const client = await googleClientFor(svc, gate.entity_id!, { allowEnv: false }).catch(() => null);
  if (!client) return NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}mail=client_not_set`, 302);

  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { error } = await svc.from("email_oauth_states").insert({ state, entity_id: gate.entity_id, redirect_to: back, created_by: gate.uid });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const params = googleConsentParams({ client, redirectUri: emailRedirectUri(url.origin), scopes: GMAIL_SCOPES, state });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
