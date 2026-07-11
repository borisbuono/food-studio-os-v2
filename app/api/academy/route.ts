import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/academy?id=…  Body: { action: 'complete' | 'uncomplete' }
// Marks a lesson complete for the current user.
export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "complete");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const { data: lesson } = await sb.from("academy_lessons").select("id,completed_by").eq("id", id).maybeSingle();
  if (!lesson) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  let completed_by = Array.isArray((lesson as any).completed_by) ? (lesson as any).completed_by : [];
  if (action === "complete") {
    if (!completed_by.includes(uid)) completed_by = [...completed_by, uid];
  } else {
    completed_by = completed_by.filter((x: string) => x !== uid);
  }

  const { data, error } = await sb.from("academy_lessons").update({ completed_by }).eq("id", id).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, lesson: data });
}
