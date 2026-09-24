import { supabaseServer } from "@/lib/supabaseServer";
import { resolveEntityScope } from "@/lib/assistant/orchestrator";
import { getMyMembershipContext } from "@/lib/memberships";
import { getFrestoAdapter } from "@/lib/integrations/fresto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/chef/now?entity=<uuid> — the "now" strip for the wall screen at
// the pass (/h/[house]/pass, Chef v3 P2 S5). Same four reads Chef answers
// by voice (lib/chef/router.ts readBookings / readPrep / readInbox), reduced
// to numbers. Polled every 60 s by PassScreen; every read is wrapped so one
// missing table never blanks the whole strip.
//
// Auth: 401 without a session, 403 when the user is not a member of the
// entity — same gate as POST /api/chef/act.

export type ChefNow = {
  covers: number;
  bookings: number;
  next_booking: { time: string; party: number; name: string } | null;
  prep_open: number;
  prep_total: number;
  inbox_waiting: number;
  ts: string;
};

function tzDate(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function tzHHmm(tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return (p.find((x) => x.type === "hour")?.value || "00") + ":" + (p.find((x) => x.type === "minute")?.value || "00");
}
function clockShort(t: string | null | undefined) { return String(t || "").slice(0, 5); }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entityId = String(url.searchParams.get("entity") || "");
  if (!entityId) return Response.json({ error: "entity required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ error: "auth" }, { status: 401 });

  const scope = await resolveEntityScope(entityId);
  if (!scope) return Response.json({ error: "unknown entity" }, { status: 404 });
  const mem = await getMyMembershipContext();
  if (!new Set((mem.memberships || []).map((m) => m.entity_id)).has(scope.entity.id)) return Response.json({ error: "not a member" }, { status: 403 });

  const tz = scope.entity.timezone || "Europe/Madrid";
  const today = tzDate(tz);
  const now = tzHHmm(tz);
  const rid = scope.restaurant_id;

  const out: ChefNow = { covers: 0, bookings: 0, next_booking: null, prep_open: 0, prep_total: 0, inbox_waiting: 0, ts: new Date().toISOString() };

  // Bookings today — DB first, Fresto live adapter when the book lives there.
  try {
    let rows: any[] = rid
      ? ((await sb.from("bookings").select("guest_name, party_size, service_time, status").eq("restaurant_id", rid).eq("service_date", today)).data || [])
      : [];
    if (!rows.length && rid) {
      try {
        const fresto = await getFrestoAdapter(rid);
        if (fresto.mode === "live") {
          const fb = await fresto.getBookings(today);
          rows = fb.map((b) => ({ guest_name: b.guestName, party_size: b.partySize, service_time: b.time, status: b.status }));
        }
      } catch { /* adapter offline — DB rows stand */ }
    }
    const live = rows.filter((b) => !["cancelled", "no_show"].includes(String(b.status || "").toLowerCase()));
    out.bookings = live.length;
    out.covers = live.reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);
    const upcoming = live
      .map((b) => ({ time: clockShort(b.service_time), party: Number(b.party_size || 0), name: String(b.guest_name || ""), seated: String(b.status || "").toLowerCase() }))
      .filter((b) => b.time && b.time >= now && !["seated", "finished"].includes(b.seated))
      .sort((a, b) => a.time.localeCompare(b.time));
    out.next_booking = upcoming.length ? { time: upcoming[0].time, party: upcoming[0].party, name: upcoming[0].name } : null;
  } catch { /* bookings unavailable */ }

  // Prep today
  try {
    const { data } = await sb.from("prep_lists").select("status").eq("entity_id", scope.entity.id).eq("service_date", today);
    const items = data || [];
    out.prep_total = items.length;
    out.prep_open = items.filter((i: any) => i.status !== "done").length;
  } catch { /* prep unavailable */ }

  // Inbox waiting
  try {
    const { data: w } = await sb.from("social_inbox_waiting").select("waiting").eq("entity_id", scope.entity.id).maybeSingle();
    out.inbox_waiting = Number((w as any)?.waiting || 0);
  } catch { /* inbox unavailable */ }

  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
