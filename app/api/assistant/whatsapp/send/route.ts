import { supabaseServer } from "@/lib/supabaseServer";
import { sendMessage } from "@/lib/assistant/channels/whatsapp-business";
import { markDraftSent } from "@/lib/assistant/channels/whatsapp-desktop";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/whatsapp/send  { channel_id, draft_id }
// Only for whatsapp_business channels. Reads the queued draft, sends via
// Meta's Cloud API, marks the queue row sent. Draft-only guard is in the
// adapter (throws unless auto_send or supervised_send).
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
  if (channel.channel_type !== "whatsapp_business") return Response.json({ ok: false, error: "send only for whatsapp_business channels — personal lines use mark-sent after copy-paste" }, { status: 400 });

  const { data: draft } = await sb.from("assistant_wa_drafts").select("id,chat_id,body,status")
    .eq("id", draftId).eq("channel_id", channelId).maybeSingle();
  if (!draft) return Response.json({ ok: false, error: "draft not found" }, { status: 404 });
  if (draft.status !== "draft") return Response.json({ ok: false, error: "draft already " + draft.status }, { status: 400 });

  try {
    const out = await sendMessage(channel as AssistantChannelRow, { to: draft.chat_id, body: draft.body });
    await markDraftSent(channel as AssistantChannelRow, draftId, u.user.id);
    await sb.from("assistant_actions").insert({
      user_id: u.user.id,
      action_type: "whatsapp.send",
      target_table: "assistant_wa_drafts",
      target_id: draftId,
      payload: { channel_id: channelId, chat_id: draft.chat_id, wa_message_id: out.wa_message_id },
      reversible: false,
    });
    return Response.json({ ok: true, wa_message_id: out.wa_message_id });
  } catch (e: any) {
    const msg = e?.message || "send failed";
    const status = /send blocked/i.test(msg) ? 403 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
