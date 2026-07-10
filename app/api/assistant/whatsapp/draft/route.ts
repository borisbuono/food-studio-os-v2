import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, EntityCode } from "@/lib/assistant/orchestrator";
import { draftForChat } from "@/lib/assistant/channels/whatsapp-desktop";
import { sendMessage as businessSendMessage, listWebhookEvents } from "@/lib/assistant/channels/whatsapp-business";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/whatsapp/draft
// { channel_id, chat_id, instructions?, hint?: recent_message?: string }
//
// - For whatsapp_personal channels: writes the AI draft to the assistant_wa_drafts queue.
// - For whatsapp_business channels: writes a draft-queue row too, since the
//   inbox surface uses the same queue for company lines waiting to be sent.
//   The Send button (gated by settings.auto_send / supervised_send) is the
//   only path that touches Meta's API.
//
// The orchestrator is invoked with mode="draft" and a compact prompt — voice
// + personality + OS context already ride on the system prompt.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const chat_id = String(body?.chat_id || "").slice(0, 200);
  const instructions = body?.instructions ? String(body.instructions).slice(0, 2000) : null;
  const recent = body?.recent_message ? String(body.recent_message).slice(0, 2000) : null;
  if (!channelId || !chat_id) return Response.json({ ok: false, error: "channel_id + chat_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "whatsapp_personal" && channel.channel_type !== "whatsapp_business") {
    return Response.json({ ok: false, error: "draft only supports WhatsApp channels" }, { status: 400 });
  }

  const entity = ((channel.settings as any)?.entity_code || "IFL") as EntityCode;

  try {
    const context = await orchestrator.getContext(entity, u.user.id, { kind: "whatsapp_draft", channel_id: channel.id, chat_id });
    const config = await orchestrator.getConfig(entity);

    // For business channels, try to pull the most recent inbound so the reply
    // has grounded context. Personal channels don't have server-side chat
    // history — the operator can pass `recent_message` in the payload.
    let inboundContext = recent || "";
    if (!inboundContext && channel.channel_type === "whatsapp_business") {
      const events = await listWebhookEvents(channel as AssistantChannelRow, undefined, 20);
      const lastFromNumber = events.find((e) => e.event_type === "message" && (e.from_number || "").replace(/[^0-9]/g, "") === chat_id.replace(/[^0-9]/g, ""));
      if (lastFromNumber?.body) inboundContext = lastFromNumber.body;
    }

    const prompt =
`Entity: ${entity}
Draft a WhatsApp reply to chat: ${chat_id}
${instructions ? `Operator instructions: ${instructions}\n` : ""}
${inboundContext ? `Most recent inbound message:\n"""\n${inboundContext}\n"""\n` : ""}

Return JSON:
{ "body": "…plain-text WhatsApp reply, no HTML, no markdown, short…" }

Voice must match the Voice block. No emojis. Keep under 90 words unless the operator asked for more. This is WhatsApp — punchy, conversational, short lines.`;

    const result = await orchestrator.generate({
      context, config, prompt, mode: "draft",
      system_extra: "You are writing a WhatsApp reply for a restaurant operator. Output STRICT JSON only. Match the entity's voice. No emojis. Keep it short and human.",
    });

    let parsed: any = null;
    const m = result.text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    const draftBody = String(parsed?.body || result.text || "").trim();
    if (!draftBody) return Response.json({ ok: false, error: "orchestrator returned an empty draft" }, { status: 502 });

    // Persist to the draft queue — same table for both channel types so the
    // inbox surface has one place to look.
    const draft = await draftForChat(channel as AssistantChannelRow, { chat_id, body: draftBody, userId: u.user.id });

    await sb.from("assistant_actions").insert({
      user_id: u.user.id,
      action_type: "whatsapp.draft",
      action_kind: "draft",
      entity_code: entity,
      target_table: "assistant_wa_drafts",
      target_id: draft.id,
      cost_eur: result.cost_eur,
      latency_ms: result.latency_ms,
      model: result.model,
      input_tokens:  result.input_tokens,
      output_tokens: result.output_tokens,
      payload: {
        entity, channel_id: channel.id, chat_id,
        draft_id: draft.id, body_preview: draftBody.slice(0, 400),
        cost_usd: result.cost_usd, cost_eur: result.cost_eur,
        latency_ms: result.latency_ms, model: result.model,
      },
      reversible: true,
    });

    return Response.json({ ok: true, draft, entity });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "draft failed" }, { status: 500 });
  }
}
