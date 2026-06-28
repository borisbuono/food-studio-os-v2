import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const { fact, scope, source_conversation_id, confidence } = await req.json();
  if (!fact) return Response.json({ ok: false, error: "fact required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser(); if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const { data, error } = await sb.from("chef_memory").insert({ user_id: u.user.id, fact: String(fact).slice(0, 600), scope: scope || "global", source_conversation_id: source_conversation_id || null, confidence: confidence ?? null }).select("id").maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data?.id });
}
