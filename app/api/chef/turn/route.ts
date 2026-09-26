import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/chef/turn — how a turn ended, for the states only the client can
// know: declined / timeout / undone / chip / edited. Own rows only (RLS).
//
// Slice A (2026-09-26): confirmed_tap / confirmed_voice / done / failed are
// written by /api/chef/act when it consumes the confirm token and runs the
// action — the browser can no longer assert that a confirmation happened.
const CLIENT_RESOLUTIONS = new Set(["declined", "timeout", "undone", "chip", "edited"]);
const SERVER_ONLY = new Set(["confirmed_tap", "confirmed_voice", "done", "failed"]);

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const turnId = String(body?.turn_id || "");
  const resolution = String(body?.resolution || "");
  if (SERVER_ONLY.has(resolution)) return Response.json({ ok: false, error: "server_written: " + resolution }, { status: 403 });
  if (!turnId || !CLIENT_RESOLUTIONS.has(resolution)) return Response.json({ ok: false, error: "turn_id + resolution required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const patch: Record<string, unknown> = { resolution, resolved_at: new Date().toISOString() };
  if (body?.result != null) patch.result = String(body.result).slice(0, 200);
  // Never overwrite a server-written resolution with a client one.
  const { error } = await sb.from("chef_turns").update(patch).eq("id", turnId).eq("user_id", u.user.id)
    .not("resolution", "in", "(confirmed_tap,confirmed_voice,done,failed)");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
