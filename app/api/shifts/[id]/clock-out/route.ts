import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/shifts/[id]/clock-out
//
// Body: { break_minutes?: number, notes?: string }
//
// Sets clock_out = now + clock_out_by = auth.uid. The user_id on the shift
// must match the caller unless the caller is a manager (RLS handles this;
// we return a friendlier error when we can).
//
// A shift can only be clocked out once — if clock_out is already set the
// call is a no-op (409).

type Body = {
  break_minutes?: number;
  notes?: string;
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").trim();
  if (!id) return Response.json({ ok: false, error: "shift id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const break_min = Math.max(0, Math.round(Number(body.break_minutes || 0)));
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const authUid = u.user?.id;
  if (!authUid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: existing, error: fetchErr } = await sb
    .from("labor_shifts")
    .select("id, entity_id, user_id, clock_in, clock_out")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return Response.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!existing) return Response.json({ ok: false, error: "shift not found" }, { status: 404 });
  if (existing.clock_out) return Response.json({ ok: false, error: "already clocked out" }, { status: 409 });
  if (!existing.clock_in) return Response.json({ ok: false, error: "shift never clocked in" }, { status: 409 });

  const update: Record<string, unknown> = {
    clock_out: new Date().toISOString(),
    clock_out_by: authUid,
    break_minutes: break_min,
  };
  if (notes) update.notes = notes;

  const { data: updated, error } = await sb
    .from("labor_shifts")
    .update(update)
    .eq("id", id)
    .select("id, entity_id, user_id, clock_in, clock_out, break_minutes, hourly_rate_eur, role, station")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, shift: updated });
}
