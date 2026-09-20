import { supabaseServer } from "@/lib/supabaseServer";
import { renderJobPost, POST_CHANNELS, PostChannel, JobOpening } from "@/lib/hiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/openings/[id]/post
//
// Body: { channels: [{ channel, target?, custom_message? }] }
//
// Creates job_posts rows in status='drafted' and returns the rendered
// message per channel. Does NOT auto-send. Boris pastes it into
// WhatsApp/Telegram/Instagram by hand and then calls /mark-posted.
//
// HARD rule: WhatsApp/Telegram/Instagram = READ, never SEND from
// scheduled runs. See boris memory `whatsapp_triage_blocked_in_scheduled_runs`.

type Item = { channel?: string; target?: string; custom_message?: string };
type Body = { channels?: Item[] };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const opening_id = String(params.id || "").trim();
  if (!opening_id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Body;
  const items = Array.isArray(body.channels) ? body.channels : [];
  if (!items.length) return Response.json({ ok: false, error: "channels[] required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: opening, error: readErr } = await sb
    .from("job_openings")
    .select(
      "id, entity_id, title, role, station, description, hours_per_week, hourly_rate_eur, start_date, languages_required, status"
    )
    .eq("id", opening_id)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!opening) return Response.json({ ok: false, error: "opening not found" }, { status: 404 });

  const drafts: Array<{
    channel: string;
    target: string | null;
    message: string;
  }> = [];
  const inserts: Array<Record<string, unknown>> = [];

  for (const it of items) {
    const channel = String(it.channel || "").trim().toLowerCase();
    if (!POST_CHANNELS.includes(channel as PostChannel)) {
      return Response.json({ ok: false, error: `unsupported channel: ${channel}` }, { status: 400 });
    }
    const target = it.target ? String(it.target).trim().slice(0, 200) : null;
    const message = renderJobPost(opening as JobOpening, channel as PostChannel, {
      customMessage: it.custom_message,
    });
    drafts.push({ channel, target, message });
    inserts.push({
      job_opening_id: opening_id,
      channel,
      channel_target: target,
      message_body: message,
      status: "drafted",
    });
  }

  const { data: rows, error } = await sb.from("job_posts").insert(inserts).select("*");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    drafts,
    posts: rows || [],
    // Belt + braces: tell the caller not to auto-send.
    send_policy: "manual",
    note: "Boris pastes these by hand. Call /mark-posted after sending.",
  });
}
