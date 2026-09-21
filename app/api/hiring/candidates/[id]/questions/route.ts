import { supabaseServer } from "@/lib/supabaseServer";
import { draftQuestions } from "@/lib/hiring-sop-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/hiring/candidates/[id]/questions → redraft the screening questions (replaces an unsent draft).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const draft = await draftQuestions(sb, params.id, uid);
  if (!draft) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, draft });
}
