import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/channels
// Create: { channel_type, account_ref, auth_ref?, settings? }
// Update: { id, settings?, revoke?: boolean }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  if (body.id) {
    const patch: any = {};
    if (body.settings && typeof body.settings === "object") patch.settings = body.settings;
    if (body.revoke) patch.revoked_at = new Date().toISOString();
    const { data, error } = await sb.from("assistant_channels").update(patch).eq("id", body.id).eq("user_id", u.user.id).select("*").maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, channel: data });
  }

  const channel_type = String(body?.channel_type || "");
  if (!["gmail","whatsapp_personal","whatsapp_business"].includes(channel_type)) return Response.json({ ok: false, error: "channel_type must be gmail|whatsapp_personal|whatsapp_business" }, { status: 400 });
  const account_ref = String(body?.account_ref || "").slice(0, 200);
  if (!account_ref) return Response.json({ ok: false, error: "account_ref required" }, { status: 400 });

  const { data, error } = await sb.from("assistant_channels").insert({
    user_id: u.user.id,
    channel_type, account_ref,
    auth_ref: body.auth_ref ? String(body.auth_ref).slice(0, 200) : null,
    settings: body.settings && typeof body.settings === "object" ? body.settings : undefined,
  }).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, channel: data });
}
