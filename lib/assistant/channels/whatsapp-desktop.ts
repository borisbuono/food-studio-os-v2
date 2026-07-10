// WhatsApp Desktop-Assist — Assistant Sprint 4 · #2.
//
// v1 approach for personal WhatsApp lines: NOT a real API integration —
// instead, the assistant writes drafts into a queue table
// (`assistant_wa_drafts`), and the user copies each one into their open
// WhatsApp Web session by hand. Nothing is ever sent from the server.
//
// The reason:
// - Meta's Business Cloud API only covers business phone numbers registered
//   through WABA. Boris's personal line (+34 664 21 32 27) can't be there.
// - Third-party WhatsApp Web scrapers (whatsapp-web.js et al.) violate the
//   Meta ToS and get numbers banned in weeks.
// - The safe middle ground is: draft on the server, let the human carry the
//   draft into WhatsApp Web themselves.
//
// v2 (later) evolves personal lines to Business Cloud API for company
// numbers as Meta opens up multi-device. Draft queue stays useful either
// way for the human-in-the-loop case.
//
// The functions here:
//   openWhatsAppWeb()               — sets a signal flag that the OS-side
//                                     surface reads (Chef FAB / inbox
//                                     "Open WhatsApp Web" button); no
//                                     server-side browser control.
//   draftForChat(channel, chat_id, body)  — writes a draft row into
//                                     assistant_wa_drafts, status='draft'.
//   getDrafts(channel, {status?})   — lists pending drafts (status='draft'
//                                     by default) for the user to review.
//   listChats(channel)              — reads the chat metadata cache
//                                     assistant_wa_chats. Populated as the
//                                     user marks drafts sent (we record the
//                                     chat there) or via an offline sync
//                                     step from an exported chat list.

import { supabaseServer } from "@/lib/supabaseServer";
import type { AssistantChannelRow } from "@/types/db";

export type WaChat = {
  id: string;
  chat_id: string;
  phone_number: string | null;
  contact_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  updated_at: string;
};

export type WaDraft = {
  id: string;
  chat_id: string;
  body: string;
  status: "draft" | "sent" | "discarded";
  created_at: string;
  sent_at: string | null;
};

// openWhatsAppWeb — the desktop-assist path can't literally open a browser
// from a server component. Instead we return the canonical WhatsApp Web URL
// (with a specific chat_id if given) so the surface can render a "Open
// WhatsApp Web" link that pops into the user's own session. We also record
// an assistant_actions row so opens are auditable.
export async function openWhatsAppWeb(channel: AssistantChannelRow, opts?: { chat_id?: string; userId?: string | null }): Promise<{ url: string }> {
  const chat = opts?.chat_id ? String(opts.chat_id) : "";
  // WhatsApp Web deep-links: https://web.whatsapp.com/send?phone=<E164 no plus>
  // for a phone number, or https://web.whatsapp.com/ to just land on the
  // conversation list.
  const digits = chat.replace(/[^0-9]/g, "");
  const url = digits ? `https://web.whatsapp.com/send?phone=${digits}` : `https://web.whatsapp.com/`;
  if (opts?.userId) {
    const sb = supabaseServer();
    await sb.from("assistant_actions").insert({
      user_id: opts.userId,
      action_type: "wa_desktop.open",
      target_table: "assistant_channels",
      target_id: channel.id,
      payload: { channel_id: channel.id, chat_id: chat || null, url },
      reversible: false,
    });
  }
  return { url };
}

export async function draftForChat(channel: AssistantChannelRow, input: {
  chat_id: string;
  body: string;
  userId?: string | null;
}): Promise<WaDraft> {
  const chat_id = String(input.chat_id || "").slice(0, 200);
  const body = String(input.body || "").trim();
  if (!chat_id) throw new Error("draftForChat: chat_id required");
  if (!body) throw new Error("draftForChat: body is empty");
  const sb = supabaseServer();
  const { data, error } = await sb.from("assistant_wa_drafts").insert({
    channel_id: channel.id,
    chat_id,
    body: body.slice(0, 4096),
    status: "draft",
  }).select("id,chat_id,body,status,created_at,sent_at").maybeSingle();
  if (error || !data) throw new Error("draftForChat: could not persist: " + (error?.message || "no row"));

  if (input.userId) {
    await sb.from("assistant_actions").insert({
      user_id: input.userId,
      action_type: "wa_desktop.draft",
      target_table: "assistant_wa_drafts",
      target_id: data.id,
      payload: { channel_id: channel.id, chat_id, body_preview: body.slice(0, 400) },
      reversible: true,
    });
  }
  return data as WaDraft;
}

export async function getDrafts(channel: AssistantChannelRow, opts?: { status?: "draft" | "sent" | "discarded" | "any"; limit?: number }): Promise<WaDraft[]> {
  const sb = supabaseServer();
  let q = sb.from("assistant_wa_drafts")
    .select("id,chat_id,body,status,created_at,sent_at")
    .eq("channel_id", channel.id)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, opts?.limit || 100)));
  const status = opts?.status || "draft";
  if (status !== "any") q = q.eq("status", status);
  const { data } = await q;
  return (data || []) as WaDraft[];
}

export async function markDraftSent(channel: AssistantChannelRow, draftId: string, userId?: string | null): Promise<WaDraft | null> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_wa_drafts").update({
    status: "sent",
    sent_at: new Date().toISOString(),
  }).eq("id", draftId).eq("channel_id", channel.id).select("id,chat_id,body,status,created_at,sent_at").maybeSingle();

  if (userId && data) {
    await sb.from("assistant_actions").insert({
      user_id: userId,
      action_type: "wa_desktop.mark_sent",
      target_table: "assistant_wa_drafts",
      target_id: draftId,
      payload: { channel_id: channel.id, chat_id: data.chat_id },
      reversible: false,
    });
    // Bump the chat cache so the surface can list this conversation next time.
    await sb.from("assistant_wa_chats").upsert({
      channel_id: channel.id,
      chat_id: data.chat_id,
      phone_number: /^\d+$/.test(data.chat_id) ? data.chat_id : null,
      last_message_preview: (data.body || "").slice(0, 200),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id,chat_id" });
  }
  return (data as WaDraft) || null;
}

export async function discardDraft(channel: AssistantChannelRow, draftId: string, userId?: string | null): Promise<void> {
  const sb = supabaseServer();
  await sb.from("assistant_wa_drafts").update({ status: "discarded" }).eq("id", draftId).eq("channel_id", channel.id);
  if (userId) {
    await sb.from("assistant_actions").insert({
      user_id: userId,
      action_type: "wa_desktop.discard",
      target_table: "assistant_wa_drafts",
      target_id: draftId,
      payload: { channel_id: channel.id },
      reversible: false,
    });
  }
}

export async function listChats(channel: AssistantChannelRow, limit = 50): Promise<WaChat[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_wa_chats")
    .select("id,chat_id,phone_number,contact_name,last_message_preview,last_message_at,unread_count,updated_at")
    .eq("channel_id", channel.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(200, limit)));
  return (data || []) as WaChat[];
}

// upsertChat — used when the surface wants to seed a contact into the cache
// (for example, when the user picks "start a new WhatsApp draft to +34…").
export async function upsertChat(channel: AssistantChannelRow, input: {
  chat_id: string; phone_number?: string | null; contact_name?: string | null;
}): Promise<WaChat | null> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_wa_chats").upsert({
    channel_id: channel.id,
    chat_id: input.chat_id,
    phone_number: input.phone_number || (/^\d+$/.test(input.chat_id) ? input.chat_id : null),
    contact_name: input.contact_name || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "channel_id,chat_id" })
    .select("id,chat_id,phone_number,contact_name,last_message_preview,last_message_at,unread_count,updated_at")
    .maybeSingle();
  return (data as WaChat) || null;
}
