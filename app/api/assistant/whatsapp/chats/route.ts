import { supabaseServer } from "@/lib/supabaseServer";
import { listChats, upsertChat } from "@/lib/assistant/channels/whatsapp-desktop";
import { listWebhookEvents } from "@/lib/assistant/channels/whatsapp-business";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/assistant/whatsapp/chats?channel_id=...
//   - whatsapp_personal channels: reads assistant_wa_chats cache.
//   - whatsapp_business channels: derives a conversation list from
//     assistant_wa_events (recent from_number values).
// POST /api/assistant/whatsapp/chats  { channel_id, chat_id, phone_number?, contact_name? }
//   - upserts a chat into the cache (personal channels only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channel_id") || "";
  if (!channelId) return Response.json({ ok: false, error: "channel_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });

  try {
    if (channel.channel_type === "whatsapp_personal") {
      const chats = await listChats(channel as AssistantChannelRow, 50);
      return Response.json({ ok: true, chats });
    }
    if (channel.channel_type === "whatsapp_business") {
      // Derive from webhook events — group by from_number, newest first.
      const events = await listWebhookEvents(channel as AssistantChannelRow, undefined, 200);
      const byNumber = new Map<string, { from: string; last_body: string | null; last_at: string }>();
      for (const e of events) {
        if (e.event_type !== "message") continue;
        const key = e.from_number || "";
        if (!key) continue;
        if (!byNumber.has(key)) byNumber.set(key, { from: key, last_body: e.body, last_at: e.received_at });
      }
      const chats = Array.from(byNumber.entries()).map(([number, v]) => ({
        chat_id: number,
        phone_number: number,
        contact_name: null,
        last_message_preview: v.last_body,
        last_message_at: v.last_at,
      }));
      return Response.json({ ok: true, chats });
    }
    return Response.json({ ok: false, error: "unsupported channel_type" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "chats failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const chat_id = String(body?.chat_id || "").slice(0, 200);
  if (!channelId || !chat_id) return Response.json({ ok: false, error: "channel_id + chat_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "whatsapp_personal") return Response.json({ ok: false, error: "chat upsert only for whatsapp_personal channels" }, { status: 400 });

  try {
    const chat = await upsertChat(channel as AssistantChannelRow, {
      chat_id,
      phone_number: body?.phone_number ? String(body.phone_number).slice(0, 40) : null,
      contact_name: body?.contact_name ? String(body.contact_name).slice(0, 120) : null,
    });
    return Response.json({ ok: true, chat });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "chat upsert failed" }, { status: 500 });
  }
}
