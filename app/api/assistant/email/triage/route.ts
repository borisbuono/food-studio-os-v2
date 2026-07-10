import { supabaseServer } from "@/lib/supabaseServer";
import { triageInbox } from "@/lib/assistant/triage/email";
import type { AssistantChannelRow } from "@/types/db";
import type { EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/email/triage
// { channel_id, since_hours? }
// → { ok, verdicts: [...] }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id || "");
  const sinceHours = Number(body?.since_hours || 24);
  if (!channelId) return Response.json({ ok: false, error: "channel_id required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: channel } = await sb.from("assistant_channels").select("*")
    .eq("id", channelId).eq("user_id", u.user.id).is("revoked_at", null).maybeSingle();
  if (!channel) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });
  if (channel.channel_type !== "gmail") return Response.json({ ok: false, error: "email triage only supports Gmail channels" }, { status: 400 });

  const entity = ((channel.settings as any)?.entity_code || "IFL") as EntityCode;
  const since = new Date(Date.now() - Math.max(1, Math.min(720, sinceHours)) * 3600 * 1000);

  try {
    const verdicts = await triageInbox(channel as AssistantChannelRow, {
      entity, userId: u.user.id, since,
    });
    return Response.json({ ok: true, verdicts, entity });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "triage failed" }, { status: 500 });
  }
}
