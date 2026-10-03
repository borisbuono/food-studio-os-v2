import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireManagerOf } from "@/lib/access/requireManager";
import { looksLikeGoogleClientId } from "@/lib/google/oauthClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/email/google-client
//   { entity, action: "set", client_id, client_secret, hosted_domain? }   paste / replace
//   { entity, action: "disable" }                                          flip off, secret leaves Vault
//
// Boris (or any manager of the house) pastes the Google OAuth client for that
// house here. The secret goes straight into Vault through oauth_client_set,
// which re-checks app_my_managed_entities() itself — so this runs on the
// signed-in user's RLS client, no service role. The secret is never logged,
// never echoed back, never stored in a column.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  let p: any;
  try { p = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const gate = await requireManagerOf(sb, String(p.entity || ""));
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  if (p.action === "set") {
    const client_id = String(p.client_id || "").trim();
    const client_secret = String(p.client_secret || "").trim();
    const hosted_domain = String(p.hosted_domain || "").trim().toLowerCase() || null;
    if (!looksLikeGoogleClientId(client_id)) return NextResponse.json({ ok: false, error: "That is not a Google OAuth client ID (it ends in .apps.googleusercontent.com)." }, { status: 400 });
    if (client_secret.length < 10) return NextResponse.json({ ok: false, error: "Client secret looks too short." }, { status: 400 });
    if (hosted_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hosted_domain)) return NextResponse.json({ ok: false, error: "Hosted domain should look like bistro-mondo.com." }, { status: 400 });
    const { error } = await sb.rpc("oauth_client_set", {
      p_entity_id: gate.entity_id, p_provider: "google", p_client_id: client_id, p_client_secret: client_secret, p_hosted_domain: hosted_domain,
    });
    if (error) return NextResponse.json({ ok: false, error: error.code === "42501" ? "Only a manager of this house can set its Google client." : "Could not save the client." }, { status: error.code === "42501" ? 403 : 500 });
    return NextResponse.json({ ok: true });
  }
  if (p.action === "disable") {
    const { error } = await sb.rpc("oauth_client_disable", { p_entity_id: gate.entity_id, p_provider: "google" });
    if (error) return NextResponse.json({ ok: false, error: error.code === "42501" ? "Only a manager of this house can disable its Google client." : "Could not disable the client." }, { status: error.code === "42501" ? 403 : 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
