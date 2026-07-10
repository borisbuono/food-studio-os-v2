import { supabaseServer } from "@/lib/supabaseServer";
import { getThread } from "@/lib/assistant/channels/gmail";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/assistant/email/threads?channel_id=...&thread_id=...
// Returns the full thread body so the /grow/inbox reader drawer can render.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channel_id") || "";
  const threadId = url.searchParams.get("thread_id") || "";
  if (!channelId || !threadId) return Response.json({ ok: false, error: "channel_id + thread_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "gmail") return Response.json({ ok: false, error: "only Gmail channels supported" }, { status: 400 });

  try {
    const thread = await getThread(channel as AssistantChannelRow, threadId);
    return Response.json({ ok: true, thread });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "fetch failed" }, { status: 500 });
  }
}
