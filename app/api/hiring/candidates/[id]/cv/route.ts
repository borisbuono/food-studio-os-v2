import { supabaseServer } from "@/lib/supabaseServer";
import { runCvPipeline } from "@/lib/hiring-sop-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/hiring/candidates/[id]/cv  → 302 to a 5-minute signed URL (private bucket)
// POST /api/hiring/candidates/[id]/cv  → re-read the stored CV (after a parse failure or a new opening)
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: c } = await sb.from("candidates").select("cv_path").eq("id", params.id).maybeSingle();
  if (!c?.cv_path) return Response.json({ ok: false, error: "no CV on file" }, { status: 404 });
  const { data, error } = await sb.storage.from("hiring-cvs").createSignedUrl(String(c.cv_path), 300);
  if (error || !data?.signedUrl) return Response.json({ ok: false, error: error?.message || "sign failed" }, { status: 500 });
  return Response.redirect(data.signedUrl, 302);
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: c } = await sb.from("candidates").select("id, cv_path, notes").eq("id", params.id).maybeSingle();
  if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  let file: { base64: string; mediaType: string } | null = null;
  if (c.cv_path) {
    const dl = await sb.storage.from("hiring-cvs").download(String(c.cv_path));
    if (dl.data) {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      file = { base64: buf.toString("base64"), mediaType: dl.data.type || "application/pdf" };
    }
  }
  if (!file && !c.notes) return Response.json({ ok: false, error: "nothing to read" }, { status: 400 });
  try {
    await runCvPipeline(sb, params.id, uid, file, String(c.notes || ""));
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "parse failed" }, { status: 500 });
  }
  const { data: cand } = await sb.from("candidates").select("*").eq("id", params.id).single();
  return Response.json({ ok: true, candidate: cand });
}
