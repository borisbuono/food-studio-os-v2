// GET /api/leads/[id]/timeline
//
// Auth-gated. Returns the touch history for a single lead. Consumed by the
// /studio/growth drawer.

import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const leadId = ctx.params.id;
  if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) {
    return Response.json({ ok: false, error: "bad lead id" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("lead_touches")
    .select("id, touched_at, channel, direction, notes, by_user")
    .eq("lead_id", leadId)
    .order("touched_at", { ascending: false });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rows: data || [] });
}
