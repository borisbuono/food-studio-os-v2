import { supabaseServer } from "@/lib/supabaseServer";
import { encryptSecret } from "@/lib/integrations/vault";

export const runtime = "nodejs";

// Vendor-specific test: return { ok, error, meta } — hits the vendor's identity/health endpoint
async function testKey(vendor: string, apiKey: string): Promise<{ ok: boolean; error?: string; meta?: any }> {
  if (vendor === "holded") {
    // Detect Holded v2 personal access tokens by the pat_ prefix. v2 uses Bearer auth
    // on api.holded.com/api/v2/*. v1 keys are 32 hex chars and use the "key:" header on v1 endpoints.
    const isV2 = apiKey.startsWith("pat_");
    const url = isV2
      ? "https://api.holded.com/api/v2/contacts?limit=1"
      : "https://api.holded.com/api/invoicing/v1/contacts?limit=1";
    const headers: Record<string, string> = isV2
      ? { "Authorization": `Bearer ${apiKey}` }
      : { "key": apiKey };
    const r = await fetch(url, { headers });
    if (r.ok) return { ok: true, meta: { api_version: isV2 ? "v2" : "v1" } };
    // 403 on v2 = token is recognized by Holded but lacks scope for /contacts.
    // Accept as connected — token is real, downstream endpoints may still work per their granted scopes.
    // 401 = token itself is invalid / rejected.
    if (r.status === 403 && isV2) return { ok: true, meta: { api_version: "v2", warning: "token valid but /contacts scope not granted — add resource scopes in Holded → Developers if downstream calls fail" } };
    if (r.status === 401) return { ok: false, error: `401 unauthorized (${isV2 ? "v2 pat_" : "v1"} key) — token is invalid or was revoked. Create a fresh token in Holded → Developers.` };
    return { ok: false, error: `Holded ${isV2 ? "v2" : "v1"} returned ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}` };
  }
  if (vendor === "wix-newsletter") {
    // Boris pastes `<account_id>:<api_key>`. We split on the first colon so the
    // adapter can read both halves without a second field on the form.
    const i = apiKey.indexOf(":");
    const accountId = i > 0 ? apiKey.slice(0, i) : (process.env.WIX_ACCOUNT_ID || "");
    const key = i > 0 ? apiKey.slice(i + 1) : apiKey;
    if (!accountId) return { ok: false, error: "paste as `<wix_account_id>:<api_key>` (get both from Wix Dashboard → Settings → API Keys)" };
    const r = await fetch("https://www.wixapis.com/email-marketing/v1/campaigns?paging.limit=1", {
      headers: { "Authorization": key, "wix-account-id": accountId },
    });
    if (r.ok) return { ok: true, meta: { account_id: accountId } };
    if (r.status === 401 || r.status === 403) return { ok: false, error: `Wix ${r.status} — token or account_id rejected. Regenerate the site API key with Email Marketing + Contacts scope.` };
    return { ok: false, error: `Wix returned ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}` };
  }
  if (vendor === "buffer") {
    // Buffer Publish API v1. `?access_token=<token>` on /1/user.json is the health check.
    const r = await fetch(`https://api.bufferapp.com/1/user.json?access_token=${encodeURIComponent(apiKey)}`);
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any));
      return { ok: true, meta: { user_id: j?.id || j?._id || null, timezone: j?.timezone || null } };
    }
    const t = (await r.text().catch(() => "")).slice(0, 300);
    if (r.status === 401 || r.status === 403) return { ok: false, error: `Buffer ${r.status} — token rejected. Regenerate a Personal Access Token at buffer.com/developers.` };
    return { ok: false, error: `Buffer returned ${r.status}: ${t}` };
  }
  if (vendor === "meta-ads") {
    // Meta Marketing API — Boris pastes a user or system-user access token that
    // has ads_read on the ad account. Account id is fixed per entity in the
    // adapter (BM = 605781129956113). Read-only for now.
    const acct = process.env.META_AD_ACCOUNT_BM || "605781129956113";
    const r = await fetch(`https://graph.facebook.com/v20.0/act_${acct}?fields=account_status,name,currency&access_token=${encodeURIComponent(apiKey)}`);
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any));
      return { ok: true, meta: { account_id: acct, account_status: j.account_status, name: j.name, currency: j.currency } };
    }
    const bodyText = (await r.text().catch(() => "")).slice(0, 400);
    if (r.status === 401 || r.status === 403 || r.status === 400) return { ok: false, error: `Meta ${r.status} — token rejected or lacks ads_read on act_${acct}. ${bodyText}` };
    return { ok: false, error: `Meta returned ${r.status}: ${bodyText}` };
  }
  // Unknown vendor: accept + store the key without a live test (better than blocking)
  return { ok: true, meta: { untested: true } };
}

export async function POST(req: Request) {
  try {
    const { entity, vendor, api_key, kind } = await req.json();
    if (!entity || !["IFL","BM","BBH"].includes(entity)) return Response.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
    if (!vendor || typeof vendor !== "string") return Response.json({ ok: false, error: "vendor required" }, { status: 400 });
    if (!api_key || typeof api_key !== "string" || api_key.length < 10) return Response.json({ ok: false, error: "api_key looks empty or too short" }, { status: 400 });

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (!u.user?.id) return Response.json({ ok: false, error: "sign in to connect an integration" }, { status: 401 });

    // 1) Test
    const t = await testKey(vendor, api_key.trim());
    if (!t.ok) return Response.json({ ok: false, error: t.error || "test failed" }, { status: 400 });

    // 2) Encrypt
    let enc;
    try { enc = encryptSecret(api_key.trim()); }
    catch (e: any) { return Response.json({ ok: false, error: "vault: " + (e?.message || "encrypt failed") }, { status: 500 }); }

    // 3) Revoke any previous active row for the same entity+vendor (soft delete)
    await sb.from("entity_integrations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("entity_code", entity).eq("platform", vendor).is("revoked_at", null);

    // 4) Insert new active row
    const { data: row, error } = await sb.from("entity_integrations").insert({
      entity_code: entity, platform: vendor,
      integration_type: kind || (vendor === "holded" || vendor === "apideck" ? "accounting" : (vendor === "wix-newsletter" || vendor === "meta-ads") ? "marketing" : vendor === "buffer" ? "social" : "unknown"),
      display_name: `${vendor} · ${entity}`,
      encrypted_key: enc.encrypted_key, key_iv: enc.key_iv, key_tag: enc.key_tag,
      status: "connected",
      last_check_at: new Date().toISOString(),
      added_by: u.user.id,
      rotated_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    // 5) Audit — chef_actions
    await sb.from("chef_actions").insert({
      user_id: u.user.id,
      action_type: "integrations.connect",
      target_table: "entity_integrations",
      target_id: row?.id,
      payload: { entity, vendor, meta: t.meta || null },
      reversible: true,
    });

    return Response.json({ ok: true, id: row?.id, entity, vendor });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
