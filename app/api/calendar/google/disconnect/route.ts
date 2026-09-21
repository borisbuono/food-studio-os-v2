import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calendar/google/disconnect → forget my tokens + my Google rows.
// (Google-side access stays until revoked at myaccount.google.com/permissions.)
export async function POST() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { error } = await sb.rpc("gcal_disconnect");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
