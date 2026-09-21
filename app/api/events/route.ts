import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, myPersonIds, peopleNames } from "@/lib/calendar.server";
import { EVENT_COLUMNS } from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/events?from=ISO&to=ISO[&entity=<uuid>][&mine=1][&external=1]
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to)))
    return Response.json({ ok: false, error: "from/to ISO required" }, { status: 400 });
  if (Date.parse(to) - Date.parse(from) > 62 * 86400_000)
    return Response.json({ ok: false, error: "window too large (max 62 days)" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  try {
    const events = await loadEvents({
      from, to,
      entityId: url.searchParams.get("entity"),
      mine: url.searchParams.get("mine") === "1",
      includeExternal: url.searchParams.get("external") === "1",
    });
    const people = await peopleNames(events.flatMap((e) => e.person_ids || []));
    return Response.json({ ok: true, events, people });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// POST /api/events — create a meeting (the only type born in `events`).
// Body: { title, start_ts, end_ts?, entity_id?, person_ids?[], location?, description? }
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as any;
  const title = String(b.title || "").trim().slice(0, 200);
  const start = b.start_ts ? new Date(b.start_ts) : null;
  const end = b.end_ts ? new Date(b.end_ts) : null;
  if (!title || !start || isNaN(start.getTime())) return Response.json({ ok: false, error: "title + start_ts required" }, { status: 400 });
  if (end && (isNaN(end.getTime()) || end < start)) return Response.json({ ok: false, error: "bad end_ts" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const mine = await myPersonIds();
  const people = Array.from(new Set([...(Array.isArray(b.person_ids) ? b.person_ids.map(String) : []), ...mine]))
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const { data, error } = await sb.from("events").insert({
    source_type: "meeting", title, start_ts: start.toISOString(), end_ts: end ? end.toISOString() : null,
    entity_id: b.entity_id || null, person_ids: people, location: b.location || null,
    description: b.description || null, created_by: u.user.id, colour: null,
  }).select(EVENT_COLUMNS).single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  return Response.json({ ok: true, event: data });
}
