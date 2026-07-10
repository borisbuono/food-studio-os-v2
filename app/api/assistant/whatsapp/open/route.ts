import { supabaseServer } from "@/lib/supabaseServer";
import { openWhatsAppWeb } from "@/lib/assistant/channels/whatsapp-desktop";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/whatsapp/open  { channel_id, chat_id? }
// Returns { url } — the surface can then window.open() it. The server does
// NOT drive the browser; this just resolves the canonical deep-link.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const chat_id = body?.chat_id ? String(body.chat_id).slice(0, 200) : "";
  if (!channelId) return Response.json({ ok: false, error: "channel_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });

  try {
    const out = await openWhatsAppWeb(channel as AssistantChannelRow, { chat_id: chat_id || undefined, userId: u.user.id });
    return Response.json({ ok: true, url: out.url });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "open failed" }, { status: 500 });
  }
}
