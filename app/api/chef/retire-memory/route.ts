import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") || "");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser(); if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  await sb.from("chef_memory").update({ retired_at: new Date().toISOString() }).eq("id", id).eq("user_id", u.user.id);
  return Response.redirect(new URL("/administrate/chef-log", req.url));
}
