import { supabaseServer } from "@/lib/supabaseServer";
import { createApideckVaultSession } from "@/lib/integrations/accounting/apideck";

export const runtime = "nodejs";

// POST { entity: "IFL" | "BM" | "BBH" } → { ok, session_uri }
// The client redirects to session_uri to open Apideck's hosted Vault chooser
// scoped to the entity's consumer. On completion, the connection is stored in
// Apideck (not in our vault) — we only remember which entities have Apideck
// wired via the entity_integrations row we insert here (empty payload).
export async function POST(req: Request) {
  try {
    const { entity } = await req.json();
    if (!entity || !["IFL", "BM", "BBH"].includes(entity)) {
      return Response.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
    }
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (!u.user?.id) return Response.json({ ok: false, error: "sign in first" }, { status: 401 });

    let session_uri: string;
    try {
      session_uri = await createApideckVaultSession(entity);
    } catch (e: any) {
      return Response.json({ ok: false, error: e?.message || "apideck session failed" }, { status: 502 });
    }
    if (!session_uri) return Response.json({ ok: false, error: "no session_uri returned from Apideck" }, { status: 502 });

    // Insert (or refresh) a marker row so /administrate/finance/setup can render
    // "Managed by Apideck" without holding a real credential.
    await sb.from("entity_integrations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("entity_code", entity).eq("platform", "apideck").is("revoked_at", null);
    await sb.from("entity_integrations").insert({
      entity_code: entity, platform: "apideck",
      integration_type: "accounting",
      display_name: `apideck · ${entity}`,
      encrypted_key: "", key_iv: "", key_tag: "",
      added_by: u.user.id, meta: { managed: "apideck-vault" },
    });

    return Response.json({ ok: true, session_uri });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
