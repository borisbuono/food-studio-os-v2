import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/assistant/playbooks
// Create: { entity_code, name, description?, priority?, triage_rules? }
// Update: { id, ...patch }
// Delete: { id, delete: true }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  if (body.delete && body.id) {
    const { error } = await sb.from("assistant_playbooks").delete().eq("id", body.id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, deleted: true });
  }

  if (body.id) {
    const patch: any = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string")        patch.name        = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.priority === "number")    patch.priority    = body.priority;
    if (Array.isArray(body.triage_rules))     patch.triage_rules = body.triage_rules;
    const { data, error } = await sb.from("assistant_playbooks").update(patch).eq("id", body.id).select("*").maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, playbook: data });
  }

  const entity = String(body?.entity_code || "").toUpperCase();
  if (!["IFL","BM","BBH"].includes(entity)) return Response.json({ ok: false, error: "entity_code required" }, { status: 400 });
  if (!body?.name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

  const { data, error } = await sb.from("assistant_playbooks").insert({
    entity_code: entity,
    name: String(body.name).slice(0, 200),
    description: body.description ? String(body.description).slice(0, 1000) : null,
    priority: typeof body.priority === "number" ? body.priority : 100,
    triage_rules: Array.isArray(body.triage_rules) ? body.triage_rules : [],
  }).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, playbook: data });
}
