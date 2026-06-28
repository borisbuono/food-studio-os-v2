import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const { conversation_id, action_type, target_table, target_id, payload, reversible } = await req.json();
  if (!action_type) return Response.json({ ok: false, error: "action_type required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser(); if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const { data, error } = await sb.from("chef_actions").insert({ user_id: u.user.id, conversation_id: conversation_id || null, action_type, target_table: target_table || null, target_id: target_id || null, payload: payload || null, reversible: !!reversible }).select("id").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data?.id });
}
