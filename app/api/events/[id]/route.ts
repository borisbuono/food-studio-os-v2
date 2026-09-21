import { supabaseServer } from "@/lib/supabaseServer";
import { EVENT_COLUMNS, canReschedule, zonedParts, type CalEvent } from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/events/<id>  { start_ts, end_ts? }  — drag-to-reschedule.
// Writes BACK TO THE SOURCE ROW; the DB trigger re-mirrors it into `events`.
// Permission is the source table's own RLS (0 rows updated → 403).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as any;
  const start = b.start_ts ? new Date(b.start_ts) : null;
  const end = b.end_ts ? new Date(b.end_ts) : null;
  if (!start || isNaN(start.getTime())) return Response.json({ ok: false, error: "start_ts required" }, { status: 400 });
  if (end && (isNaN(end.getTime()) || end < start)) return Response.json({ ok: false, error: "bad end_ts" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: ev } = await sb.from("events").select(EVENT_COLUMNS).eq("id", params.id).maybeSingle();
  const e = ev as CalEvent | null;
  if (!e) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (!canReschedule(e)) return Response.json({ ok: false, error: `${e.source_type} can't be moved from the calendar` }, { status: 409 });

  const s = start.toISOString();
  const en = end ? end.toISOString() : null;
  let res: { data: any; error: any };

  switch (e.source_type) {
    case "meeting":
      res = await sb.from("events").update({ start_ts: s, end_ts: en }).eq("id", e.id).select("id");
      break;
    case "shift": {
      // A shift that has been clocked into is history, not a plan.
      const { data: sh } = await sb.from("labor_shifts").select("clock_in").eq("id", e.source_id!).maybeSingle();
      if ((sh as any)?.clock_in) return Response.json({ ok: false, error: "shift already clocked in" }, { status: 409 });
      res = await sb.from("labor_shifts").update({ scheduled_start: s, scheduled_end: en }).eq("id", e.source_id!).select("id");
      break;
    }
    case "interview":
      res = await sb.from("interviews").update({ scheduled_at: s }).eq("id", e.source_id!).select("id");
      break;
    case "task":
      res = await sb.from("master_todos").update({ due_at: s }).eq("id", e.source_id!).select("id");
      break;
    case "social": {
      const { data: p } = await sb.from("social_posts").select("approved_by_boris, status").eq("id", e.source_id!).maybeSingle();
      if ((p as any)?.approved_by_boris || (p as any)?.status === "published")
        return Response.json({ ok: false, error: "approved/published posts are moved from Grow · Reach" }, { status: 409 });
      res = await sb.from("social_posts").update({ scheduled_at: s }).eq("id", e.source_id!).select("id");
      break;
    }
    case "sales_event": {
      const tz = e.timezone || "Europe/Madrid";
      const a = zonedParts(start, tz);
      const patch: Record<string, any> = {
        event_date: a.ymd,
        service_window_start: `${String(a.hour).padStart(2, "0")}:${String(a.minute).padStart(2, "0")}`,
      };
      if (end) {
        const z = zonedParts(end, tz);
        patch.service_window_end = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
      }
      res = await sb.from("sales_events").update(patch).eq("id", e.source_id!).select("id");
      break;
    }
    default:
      return Response.json({ ok: false, error: "not movable" }, { status: 409 });
  }
  if (res.error) return Response.json({ ok: false, error: res.error.message }, { status: 500 });
  if (!res.data?.length) return Response.json({ ok: false, error: "not allowed" }, { status: 403 });

  const { data: fresh } = await sb.from("events").select(EVENT_COLUMNS).eq("id", e.id).maybeSingle();
  return Response.json({ ok: true, event: fresh });
}

// DELETE /api/events/<id> — meetings only; mirrored rows are deleted at source.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.from("events").delete().eq("id", params.id).eq("source_type", "meeting").select("id");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ ok: false, error: "not found or not yours" }, { status: 404 });
  return Response.json({ ok: true });
}
