import { supabaseServer } from "@/lib/supabaseServer";
import { parseReply, readyForInterview, type CvProfile } from "@/lib/hiring-sop";
import { mirrorColumns, moveStatus, rescore } from "@/lib/hiring-sop-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/hiring/candidates/[id]/reply  { text, channel? }
// Paste the candidate's answer. Logs it, extracts the answers into the
// profile, re-scores, moves new → screening. Suggests (never forces) interview.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; channel?: string };
  const text = String(body.text || "").trim();
  if (!text) return Response.json({ ok: false, error: "paste the reply" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data: c } = await sb.from("candidates").select("id, profile, review_flags").eq("id", params.id).maybeSingle();
  if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  await sb.from("candidate_touches").insert({
    candidate_id: params.id,
    channel: String(body.channel || "email").slice(0, 40),
    direction: "inbound",
    kind: "reply",
    body: text.slice(0, 10000),
    notes: "reply to screening questions",
    by_user: uid,
  });

  let concerns: string[] = [];
  try {
    const out = await parseReply(text);
    concerns = out.concerns;
    const profile = { ...((c.profile || {}) as object), ...out.answers } as Partial<CvProfile>;
    await sb.from("candidates").update({ profile, ...mirrorColumns(profile) }).eq("id", params.id);
  } catch (e: any) {
    return Response.json({ ok: false, error: "reply saved, but not read: " + (e?.message || "error") }, { status: 500 });
  }
  const scored = await rescore(sb, params.id);
  if (concerns.length) {
    const { data: cur } = await sb.from("candidates").select("review_flags").eq("id", params.id).single();
    await sb.from("candidates").update({ review_flags: [...((cur?.review_flags as string[]) || []), ...concerns.slice(0, 5)] }).eq("id", params.id);
  }
  await moveStatus(sb, params.id, uid, "screening", "replied to questions", ["new"]);
  const { data: cand } = await sb.from("candidates").select("*").eq("id", params.id).single();
  const ready = readyForInterview(scored?.score ?? 0, (cand?.profile || {}) as Partial<CvProfile>);
  return Response.json({ ok: true, candidate: cand, concerns, ready_for_interview: ready });
}
