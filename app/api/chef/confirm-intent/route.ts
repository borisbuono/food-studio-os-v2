import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const { text, classified_intent, confirmed_intent, classifier_confidence, language } = await req.json();
  if (!text || !confirmed_intent) return Response.json({ ok: false, error: "text + confirmed_intent required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser(); if (!u.user?.id) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const { error } = await sb.from("assistant_intents").insert({ user_id: u.user.id, text, classified_intent, confirmed_intent, classifier_confidence, language });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
