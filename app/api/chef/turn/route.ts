import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/chef/turn — how a turn ended. The router logs the turn when it
// classifies; the client reports the resolution (confirmed_tap /
// confirmed_voice / declined / timeout / undone / done) once the user has
// acted. Own rows only (RLS), so this cannot rewrite anyone else's log.
const RESOLUTIONS = new Set(["confirmed_tap", "confirmed_voice", "declined", "timeout", "undone", "done", "chip", "edited"]);

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const turnId = String(body?.turn_id || "");
  const resolution = String(body?.resolution || "");
  if (!turnId || !RESOLUTIONS.has(resolution)) return Response.json({ ok: false, error: "turn_id + resolution required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const patch: Record<string, unknown> = { resolution, resolved_at: new Date().toISOString() };
  if (body?.result != null) patch.result = String(body.result).slice(0, 200);
  const { error } = await sb.from("chef_turns").update(patch).eq("id", turnId).eq("user_id", u.user.id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
