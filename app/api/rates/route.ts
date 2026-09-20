import { supabaseServer } from "@/lib/supabaseServer";
import { todayInTz, entityTimezone } from "@/lib/labor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/rates?entity=<id>            list current rates for the entity
// POST /api/rates                        upsert a rate (manager+ only)
//
// POST body: { entity_id, user_id, role?, hourly_rate_eur, effective_from? }
// If effective_from omitted, we use today (in the entity's tz). Any earlier
// open rate row for the same (entity, user) gets its effective_to sealed
// so lookups still resolve a single active rate.

type PostBody = {
  entity_id?: string;
  user_id?: string;
  role?: string;
  hourly_rate_eur?: number | string;
  effective_from?: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entity_id = String(searchParams.get("entity") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity query param required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const tz = await entityTimezone(entity_id);
  const today = todayInTz(tz);

  const { data: rows, error } = await sb
    .from("labor_hourly_rates")
    .select("id, user_id, role, hourly_rate_eur, effective_from, effective_to")
    .eq("entity_id", entity_id)
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Only keep the most-recent open rate per user (current rate).
  const seen = new Set<string>();
  const current: any[] = [];
  for (const r of rows || []) {
    if (r.effective_to && r.effective_to < today) continue;
    if (seen.has(r.user_id as string)) continue;
    seen.add(r.user_id as string);
    current.push(r);
  }

  const userIds = current.map((r) => r.user_id as string);
  const names = new Map<string, string | null>();
  if (userIds.length) {
    const { data: members } = await sb
      .from("team_members")
      .select("auth_user_id, name")
      .in("auth_user_id", userIds);
    for (const m of members || []) names.set(m.auth_user_id as string, (m.name as string | null) || null);
  }
  const withNames = current.map((r) => ({ ...r, name: names.get(r.user_id) || null }));

  return Response.json({ ok: true, rates: withNames, as_of: today, tz });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const entity_id = String(body.entity_id || "").trim();
  const user_id   = String(body.user_id   || "").trim();
  const rate      = Number(body.hourly_rate_eur);

  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!user_id)   return Response.json({ ok: false, error: "user_id required"   }, { status: 400 });
  if (!isFinite(rate) || rate < 0) return Response.json({ ok: false, error: "hourly_rate_eur must be a non-negative number" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const authUid = u.user?.id;
  if (!authUid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid: authUid, ent: entity_id });
  if (!mgr) return Response.json({ ok: false, error: "manager required to set rates" }, { status: 403 });

  const tz = await entityTimezone(entity_id);
  const from = String(body.effective_from || todayInTz(tz)).trim();

  // Seal any open earlier row so we always have a single active rate.
  await sb
    .from("labor_hourly_rates")
    .update({ effective_to: prevDay(from) })
    .eq("entity_id", entity_id)
    .eq("user_id", user_id)
    .is("effective_to", null)
    .lt("effective_from", from);

  const { data: inserted, error } = await sb
    .from("labor_hourly_rates")
    .upsert({
      entity_id,
      user_id,
      role: body.role ? String(body.role).trim().slice(0, 40) : null,
      hourly_rate_eur: rate,
      effective_from: from,
    }, { onConflict: "entity_id,user_id,effective_from" })
    .select("id, entity_id, user_id, role, hourly_rate_eur, effective_from, effective_to")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rate: inserted });
}

function prevDay(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
