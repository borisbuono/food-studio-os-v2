import { supabaseServer } from "@/lib/supabaseServer";
import { decryptSecret } from "@/lib/integrations/vault";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

    const { data: row } = await sb.from("entity_integrations")
      .select("id,entity_code,platform,encrypted_key,key_iv,key_tag")
      .eq("id", id).is("revoked_at", null).maybeSingle();
    if (!row?.encrypted_key) return Response.json({ ok: false, error: "integration not found or has no stored key" }, { status: 404 });

    const apiKey = decryptSecret({ encrypted_key: row.encrypted_key, key_iv: row.key_iv, key_tag: row.key_tag });
    let ok = true, err: string | undefined;
    if (row.platform === "holded") {
      const r = await fetch("https://api.holded.com/api/invoicing/v1/contacts?limit=1", { headers: { key: apiKey } });
      ok = r.ok;
      if (!ok) err = `Holded ${r.status}`;
    }

    await sb.from("entity_integrations").update({
      status: ok ? "connected" : "error",
      last_check_at: new Date().toISOString(),
      last_error: ok ? null : (err || "unknown"),
    }).eq("id", id);

    return Response.json({ ok, error: err });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
