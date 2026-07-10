import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/config
// { entity_code, voice_profile?, personality_dials?, working_hours?, quiet_hours?, timezone? }
// Upserts by entity_code. Idempotent.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity = String(body?.entity_code || "").toUpperCase();
  const isKnown = ["IFL","BM","BBH"].includes(entity);
  const isAdv   = entity.startsWith("ADV-");
  if (!isKnown && !isAdv) return Response.json({ ok: false, error: "entity_code required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const patch: any = { entity_code: entity, updated_at: new Date().toISOString() };
  if (typeof body.voice_profile === "string")      patch.voice_profile     = body.voice_profile;
  if (body.personality_dials && typeof body.personality_dials === "object") patch.personality_dials = body.personality_dials;
  if (body.working_hours && typeof body.working_hours === "object")         patch.working_hours     = body.working_hours;
  if (body.quiet_hours   && typeof body.quiet_hours   === "object")         patch.quiet_hours       = body.quiet_hours;
  if (typeof body.timezone === "string")           patch.timezone          = body.timezone;

  const { data, error } = await sb.from("assistant_config").upsert(patch, { onConflict: "entity_code" }).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, config: data });
}
