import { supabaseServer } from "@/lib/supabaseServer";
import { sendDraftFor } from "@/lib/assistant/triage/email";
import type { AssistantChannelRow } from "@/types/db";
import type { EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/email/send-draft
// { channel_id, draft_id }
// → { ok, sent_id }
// Gated by channel.settings.auto_send OR settings.supervised_send. If neither
// is on, the adapter refuses and this endpoint returns 403.
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
  if (channel.channel_type !== "gmail") return Response.json({ ok: false, error: "send only supports Gmail channels" }, { status: 400 });

  const entity = ((channel.settings as any)?.entity_code || "IFL") as EntityCode;

  try {
    const out = await sendDraftFor(channel as AssistantChannelRow, {
      userId: u.user.id, entity, draft_id: draftId,
    });
    return Response.json({ ok: true, sent_id: out.sent_id });
  } catch (e: any) {
    // If the adapter refused because auto_send is off, surface that as 403.
    const msg = e?.message || "send failed";
    const status = /send blocked/i.test(msg) ? 403 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
