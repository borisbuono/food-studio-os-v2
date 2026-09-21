import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/cvs/purge-orphans  { entity_id }  manager only
// Deletes CV files in hiring-cvs/<entity>/ that no candidate points to
// (deleted test rows, failed submissions).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { entity_id?: string };
  const ent = String(b.entity_id || "");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent });
  if (!mgr) return Response.json({ ok: false, error: "manager required" }, { status: 403 });
  const { data: files, error } = await sb.storage.from("hiring-cvs").list(ent, { limit: 1000 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const { data: cands } = await sb.from("candidates").select("cv_path").eq("entity_id", ent).not("cv_path", "is", null);
  const keep = new Set((cands || []).map((c) => String(c.cv_path)));
  const orphans = (files || []).map((f) => `${ent}/${f.name}`).filter((p) => !keep.has(p));
  if (orphans.length) await sb.storage.from("hiring-cvs").remove(orphans);
  return Response.json({ ok: true, removed: orphans.length });
}
