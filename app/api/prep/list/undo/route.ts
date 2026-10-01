import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/prep/list/undo  body { ids: uuid[] }
//   Removes prep rows a generator just inserted — only rows still 'todo'
//   (a ticked box is someone's work and stays). RLS scopes to the caller's
//   houses. This is the undo for "Generate prep for tonight".
function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(isUuid).slice(0, 500) : [];
  if (!ids.length) return Response.json({ ok: false, error: "ids required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  const { data, error } = await sb.from("prep_lists").delete().in("id", ids).eq("status", "todo").select("id");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, removed: (data || []).length, kept: ids.length - (data || []).length });
}
