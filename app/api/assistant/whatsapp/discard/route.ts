import { supabaseServer } from "@/lib/supabaseServer";
import { discardDraft } from "@/lib/assistant/channels/whatsapp-desktop";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/whatsapp/discard  { channel_id, draft_id }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const draftId = String(body?.draft_id || "");
  if (!channelId || !draftId) return Response.json({ ok: false, error: "channel_id + draft_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });

  try {
    await discardDraft(channel as AssistantChannelRow, draftId, u.user.id);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "discard failed" }, { status: 500 });
  }
}
