import { supabaseServer } from "@/lib/supabaseServer";
import { draftReply } from "@/lib/assistant/triage/email";
import type { AssistantChannelRow } from "@/types/db";
import type { EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/email/draft
// { channel_id, thread_id, instructions? }
// → { ok, draft: { draft_id, subject, to, body, ... } }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const threadId = String(body?.thread_id || "");
  const instructions = body?.instructions ? String(body.instructions).slice(0, 2000) : null;
  if (!channelId || !threadId) return Response.json({ ok: false, error: "channel_id + thread_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "gmail") return Response.json({ ok: false, error: "draft only supports Gmail channels" }, { status: 400 });

  const entity = ((channel.settings as any)?.entity_code || "IFL") as EntityCode;

  try {
    const draft = await draftReply(channel as AssistantChannelRow, {
      entity, userId: u.user.id, thread_id: threadId, instructions,
    });
    return Response.json({ ok: true, draft, entity });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "draft failed" }, { status: 500 });
  }
}
