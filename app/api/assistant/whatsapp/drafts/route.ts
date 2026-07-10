import { supabaseServer } from "@/lib/supabaseServer";
import { draftForChat, getDrafts } from "@/lib/assistant/channels/whatsapp-desktop";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/assistant/whatsapp/drafts?channel_id=...&status=draft|sent|discarded|any
// POST /api/assistant/whatsapp/drafts  { channel_id, chat_id, body }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channel_id") || "";
  const status = (url.searchParams.get("status") || "draft") as any;
  if (!channelId) return Response.json({ ok: false, error: "channel_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "whatsapp_personal") return Response.json({ ok: false, error: "drafts endpoint only for whatsapp_personal channels" }, { status: 400 });

  try {
    const drafts = await getDrafts(channel as AssistantChannelRow, { status });
    return Response.json({ ok: true, drafts });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "list drafts failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const chat_id = String(body?.chat_id || "").slice(0, 200);
  const bodyText = String(body?.body || "").slice(0, 4096);
  if (!channelId || !chat_id || !bodyText) return Response.json({ ok: false, error: "channel_id + chat_id + body required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "whatsapp_personal") return Response.json({ ok: false, error: "drafts endpoint only for whatsapp_personal channels" }, { status: 400 });

  try {
    const draft = await draftForChat(channel as AssistantChannelRow, { chat_id, body: bodyText, userId: u.user.id });
    return Response.json({ ok: true, draft });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "draft failed" }, { status: 500 });
  }
}
