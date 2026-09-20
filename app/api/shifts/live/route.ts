import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shifts/live?entity=<id>
//
// Who's currently on the floor: clock_in NOT NULL AND clock_out IS NULL.
// Ordered by clock_in ascending so the earliest-clocked-in card sorts first.
//
// Response: { ok, shifts: [{ id, user_id, name, email, role, station,
//   clock_in, hourly_rate_eur }] }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity_id = String(searchParams.get("entity") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity query param required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: rows, error } = await sb
    .from("labor_shifts")
    .select("id, user_id, role, station, clock_in, hourly_rate_eur")
    .eq("entity_id", entity_id)
    .is("clock_out", null)
    .not("clock_in", "is", null)
    .order("clock_in", { ascending: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((rows || []).map((r: any) => r.user_id)));
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length) {
    const { data: members } = await sb
      .from("team_members")
      .select("auth_user_id, name, email")
      .in("auth_user_id", userIds);
    for (const m of members || []) {
      names.set(m.auth_user_id as string, { name: m.name as string | null, email: m.email as string | null });
    }
  }

  const shifts = (rows || []).map((r: any) => ({
    ...r,
    name: names.get(r.user_id)?.name || null,
    email: names.get(r.user_id)?.email || null,
  }));

  return Response.json({ ok: true, shifts });
}
