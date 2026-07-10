import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

    const { data: row } = await sb.from("entity_integrations").select("entity_code,platform").eq("id", id).maybeSingle();
    const { error } = await sb.from("entity_integrations").update({ revoked_at: new Date().toISOString(), status: "revoked" }).eq("id", id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    await sb.from("assistant_actions").insert({
      user_id: u.user.id,
      action_type: "integrations.revoke",
      target_table: "entity_integrations",
      target_id: id,
      payload: { entity: row?.entity_code, vendor: row?.platform },
      reversible: false,
    });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
