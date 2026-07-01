import { supabaseServer } from "@/lib/supabaseServer";
import { encryptSecret } from "@/lib/integrations/vault";

export const runtime = "nodejs";

// Vendor-specific test: return { ok, error, meta } — hits the vendor's identity/health endpoint
async function testKey(vendor: string, apiKey: string): Promise<{ ok: boolean; error?: string; meta?: any }> {
  if (vendor === "holded") {
    // Holded doesn't have a canonical /me endpoint; contacts is a lightweight read
    const r = await fetch("https://api.holded.com/api/invoicing/v1/contacts?limit=1", { headers: { key: apiKey } });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, error: "401 unauthorized — check the key was copied correctly and belongs to the right entity's Holded account" };
    return { ok: false, error: `Holded returned ${r.status}: ${await r.text().catch(() => "")}` };
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
      integration_type: kind || (vendor === "holded" ? "accounting" : "unknown"),
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
