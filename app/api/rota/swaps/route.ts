import { isManager, requireUser } from "@/lib/rota/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota S6 — shift swaps (Boris's ruling A, 2026-10-01).
// GET  /api/rota/swaps?entity=<uuid>          → for one house: my upcoming shifts, open offers I can take, the manager queue, recent decisions
//      /api/rota/swaps                        → across my houses (used by /me/today)
// POST /api/rota/swaps { action: "offer", shift_id, note? }      → fn_swap_offer   (the person on the shift, or a manager)
//                      { action: "claim" | "unclaim" | "cancel", swap_id } → fn_swap_claim / fn_swap_unclaim / fn_swap_cancel
//                      { action: "approve" | "reject", swap_id, note? }    → fn_swap_decide (manager; re-points the shift, calendar follows)
// No swap happens without the manager's tick. Every RPC re-checks who is calling.

const SHIFT = "id, entity_id, person_id, service_date, start_time, end_time, role, station, area, planned_minutes, status";
const SWAP = "id, entity_id, shift_id, from_person, to_person, status, note, offered_at, claimed_at, decided_at, decision_note";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity = String(u.searchParams.get("entity") || "").trim() || null;
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const today = new Date().toISOString().slice(0, 10);

  // who am I (person ids) and which houses
  const { data: me } = await sb.from("team_members").select("id").eq("auth_user_id", uid);
  const myIds = (me || []).map((t: any) => t.id as string);
  let entities: string[] = entity ? [entity] : [];
  if (!entity && myIds.length) {
    const { data: ms } = await sb.from("memberships").select("entity_id").in("person_id", myIds).eq("status", "active");
    entities = Array.from(new Set((ms || []).map((m: any) => m.entity_id as string)));
  }
  const mgrFlags = await Promise.all(entities.map((e) => isManager(sb, uid, e)));
  const managerOf = entities.filter((_, i) => mgrFlags[i]);

  const [mineRes, swapsRes] = await Promise.all([
    myIds.length ? sb.from("rota_shifts").select(SHIFT).in("person_id", myIds).in("entity_id", entities.length ? entities : ["00000000-0000-0000-0000-000000000000"]).eq("status", "published").gte("service_date", today).order("service_date").order("start_time").limit(60) : Promise.resolve({ data: [] as any[] }),
    entities.length ? sb.from("shift_swaps").select(SWAP).in("entity_id", entities).or(`status.in.(offered,claimed),decided_at.gte.${new Date(Date.now() - 14 * 864e5).toISOString()}`).order("offered_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] as any[] }),
  ]);
  const swaps = (swapsRes.data || []) as any[];
  const shiftIds = Array.from(new Set(swaps.map((s) => s.shift_id)));
  const { data: swapShifts } = shiftIds.length ? await sb.from("rota_shifts").select(SHIFT).in("id", shiftIds) : { data: [] as any[] };
  const shiftBy = new Map<string, any>(((swapShifts || []) as any[]).map((s) => [s.id, s]));
  const personIds = Array.from(new Set([...swaps.map((s) => s.from_person), ...swaps.map((s) => s.to_person), ...((mineRes.data || []) as any[]).map((s) => s.person_id)].filter(Boolean)));
  const { data: tms } = personIds.length ? await sb.from("team_members").select("id, name").in("id", personIds) : { data: [] as any[] };
  const names: Record<string, string> = {};
  for (const t of (tms || []) as any[]) names[t.id] = t.name || "—";
  const { data: ents } = entities.length ? await sb.from("entities").select("id, name, slug, timezone").in("id", entities) : { data: [] as any[] };

  const withShift = (s: any) => ({ ...s, shift: shiftBy.get(s.shift_id) || null, from_name: names[s.from_person] || "—", to_name: s.to_person ? names[s.to_person] || "—" : null });
  const open = swaps.filter((s) => s.status === "offered" && !myIds.includes(s.from_person)).map(withShift);
  const myOffers = swaps.filter((s) => ["offered", "claimed"].includes(s.status) && (myIds.includes(s.from_person) || (s.to_person && myIds.includes(s.to_person)))).map(withShift);
  const queue = swaps.filter((s) => s.status === "claimed" && managerOf.includes(s.entity_id)).map(withShift);
  const offeredOnly = swaps.filter((s) => s.status === "offered" && managerOf.includes(s.entity_id)).map(withShift);
  const recent = swaps.filter((s) => ["approved", "rejected", "cancelled"].includes(s.status)).map(withShift).slice(0, 30);
  const openByShift: Record<string, any> = {};
  for (const s of swaps) if (["offered", "claimed"].includes(s.status)) openByShift[s.shift_id] = s;
  const mine = ((mineRes.data || []) as any[]).map((s) => ({ ...s, swap: openByShift[s.id] ? withShift(openByShift[s.id]) : null }));

  return Response.json({ ok: true, my_person_ids: myIds, manager_of: managerOf, entities: ents || [], names, mine, open, my_offers: myOffers, queue, offered: offeredOnly, recent });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const { sb, uid } = await requireUser();
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const note = body.note ? String(body.note).slice(0, 200) : null;
  let res: { data: any; error: any };
  if (action === "offer") {
    const shift_id = String(body.shift_id || "");
    if (!shift_id) return Response.json({ ok: false, error: "shift_id required" }, { status: 400 });
    res = await sb.rpc("fn_swap_offer", { p_shift: shift_id, p_note: note });
  } else {
    const swap_id = String(body.swap_id || "");
    if (!swap_id) return Response.json({ ok: false, error: "swap_id required" }, { status: 400 });
    if (action === "claim") res = await sb.rpc("fn_swap_claim", { p_swap: swap_id });
    else if (action === "unclaim") res = await sb.rpc("fn_swap_unclaim", { p_swap: swap_id });
    else if (action === "cancel") res = await sb.rpc("fn_swap_cancel", { p_swap: swap_id });
    else if (action === "approve" || action === "reject") res = await sb.rpc("fn_swap_decide", { p_swap: swap_id, p_approve: action === "approve", p_note: note });
    else return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
  if (res.error) return Response.json({ ok: false, error: res.error.message.replace(/^.*?: /, "") }, { status: /manager|only|not yours|not on this team/.test(res.error.message) ? 403 : 400 });
  return Response.json({ ok: true, swap: Array.isArray(res.data) ? res.data[0] : res.data });
}
