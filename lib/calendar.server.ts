// calendar.server.ts — server-side reads for the calendar surfaces.
// Every query runs as the signed-in user; RLS on `events` decides visibility.
import { supabaseServer } from "@/lib/supabaseServer";
import { EVENT_COLUMNS, type CalEvent } from "@/lib/calendar";

export async function myPersonIds(): Promise<string[]> {
  const sb = supabaseServer();
  const { data } = await sb.rpc("app_my_person_ids");
  return ((data as any[]) || []).map((r: any) => (typeof r === "string" ? r : r.app_my_person_ids)).filter(Boolean);
}

export type EventQuery = {
  from: string;          // ISO, inclusive
  to: string;            // ISO, exclusive
  entityId?: string | null;
  mine?: boolean;        // only rows I'm on (person_ids) or created
  includeExternal?: boolean;
};

export async function loadEvents(q: EventQuery): Promise<CalEvent[]> {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return [];
  // Overlap, not containment: anything starting before `to` and ending after `from`.
  // Rows with no end are point events → start in window. Pull a day earlier to
  // catch late shifts that cross midnight, then trim.
  const padFrom = new Date(new Date(q.from).getTime() - 86400_000).toISOString();
  let query = sb.from("events").select(EVENT_COLUMNS).gte("start_ts", padFrom).lt("start_ts", q.to)
    .order("start_ts", { ascending: true }).limit(2000);
  if (q.entityId) query = query.eq("entity_id", q.entityId);
  if (!q.includeExternal) query = query.neq("source_type", "external");
  if (q.mine) {
    const ids = await myPersonIds();
    const parts = [`created_by.eq.${u.user.id}`];
    if (ids.length) parts.push(`person_ids.ov.{${ids.join(",")}}`);
    query = query.or(parts.join(","));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const fromMs = new Date(q.from).getTime();
  return ((data || []) as CalEvent[]).filter((e) => {
    const end = e.end_ts ? new Date(e.end_ts).getTime() : new Date(e.start_ts).getTime() + 1;
    return end > fromMs;
  });
}

export async function peopleNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const sb = supabaseServer();
  const { data } = await sb.from("team_members").select("id, name").in("id", Array.from(new Set(ids)).slice(0, 300));
  const out: Record<string, string> = {};
  for (const r of (data || []) as any[]) out[r.id] = r.name || "—";
  return out;
}

// The signed-in user's venues (slug/name/tz) and the zone their calendar
// should render in: the most common zone across their memberships.
export async function myEntities(): Promise<{
  ids: string[]; slugs: Record<string, string>; names: Record<string, string>; tz: string;
}> {
  const sb = supabaseServer();
  const { data: ids } = await sb.rpc("current_person_entities");
  const list = ((ids as any[]) || []).map((r: any) => (typeof r === "string" ? r : r.current_person_entities)).filter(Boolean);
  if (!list.length) return { ids: [], slugs: {}, names: {}, tz: "Europe/Madrid" };
  const { data } = await sb.from("entities").select("id, slug, name, timezone, entity_type").in("id", list);
  const slugs: Record<string, string> = {};
  const names: Record<string, string> = {};
  const tzCount: Record<string, number> = {};
  for (const e of (data || []) as any[]) {
    if (e.entity_type === "operating_venue") slugs[e.id] = e.slug;
    names[e.id] = e.name;
    const z = e.timezone || "Europe/Madrid";
    tzCount[z] = (tzCount[z] || 0) + 1;
  }
  const tz = Object.entries(tzCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "Europe/Madrid";
  return { ids: list, slugs, names, tz };
}
