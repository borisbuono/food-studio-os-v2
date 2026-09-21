// houseSnapshots.server.ts — newest eod_pos row per house, keyed by entity id.
//
// Replaces the two ENTITY_TO_RID name→restaurant maps that /studio and
// /studio/houses each carried (the /studio/houses copy never learned about
// Utopia, so its tile said "No closes yet"). The restaurant is resolved from
// restaurants.entity_id, falling back to the pinned constant for the three
// primary houses — any new tenant with a restaurants row works unchanged.

import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";

export type PosSnap = {
  date: string;
  gross: number;
  tickets: number | null;
  guests: number | null;
  guests_daily: number | null;
  guests_source: string | null;
  z_spans_days: boolean;
  peak_hour: string | null;
  peak_hour_revenue: number | null;
  hourly_revenue: Record<string, number> | null;
};

export type HouseSnapshot = { restaurant_id: string | null; pos: PosSnap | null };

// entity id → restaurants.id, for the entities the caller may see. Shared by
// every Studio surface that needs POS rows for a set of houses (/studio,
// /studio/houses, /studio/money) — they each used to carry their own
// entities.name → restaurant UUID map, which is what made Utopia and every
// new tenant invisible.
export async function getRestaurantIdsByEntity(entityIds: string[]): Promise<Map<string, string>> {
  const ridByEntity = new Map<string, string>();
  if (!entityIds.length) return ridByEntity;
  const sb = supabaseServer();
  try {
    const { data } = await sb.from("restaurants").select("id, entity_id").in("entity_id", entityIds);
    for (const r of (data as any[]) || []) {
      if (r.entity_id && !ridByEntity.has(r.entity_id)) ridByEntity.set(r.entity_id, r.id);
    }
  } catch { /* fall back to the pinned map below */ }
  for (const id of entityIds) {
    if (!ridByEntity.has(id)) {
      const pinned = ENTITY_TO_RESTAURANT[id as EntityKey];
      if (pinned) ridByEntity.set(id, pinned);
    }
  }
  return ridByEntity;
}

export async function getHouseSnapshots(entityIds: string[]): Promise<Map<string, HouseSnapshot>> {
  const out = new Map<string, HouseSnapshot>();
  if (!entityIds.length) return out;
  const sb = supabaseServer();

  const ridByEntity = await getRestaurantIdsByEntity(entityIds);

  const rids = Array.from(new Set(ridByEntity.values()));
  const posByRid = new Map<string, PosSnap>();
  // One query per restaurant — a shared `limit(60)` across houses let a busy
  // house crowd a quiet one out of the window, and the quiet one is exactly
  // the house whose stale close we need to show.
  await Promise.all(rids.map(async (rid) => {
    const { data } = await sb
      .from("eod_pos")
      .select("restaurant_id,date,total_gross_eur,tickets,guests,guests_daily,guests_source,z_spans_days,peak_hour,peak_hour_revenue,hourly_revenue")
      .eq("restaurant_id", rid)
      .order("date", { ascending: false })
      .limit(1);
    const r: any = (data || [])[0];
    if (!r) return;
    posByRid.set(rid, {
      date: String(r.date),
      gross: Number(r.total_gross_eur || 0),
      tickets: r.tickets == null ? null : Number(r.tickets),
      guests: r.guests == null ? null : Number(r.guests),
      guests_daily: r.guests_daily == null ? null : Number(r.guests_daily),
      guests_source: (r.guests_source as string | null) || null,
      z_spans_days: !!r.z_spans_days,
      peak_hour: (r.peak_hour as string | null) || null,
      peak_hour_revenue: r.peak_hour_revenue == null ? null : Number(r.peak_hour_revenue),
      hourly_revenue: (r.hourly_revenue as Record<string, number> | null) || null,
    });
  }));

  for (const id of entityIds) {
    const rid = ridByEntity.get(id) ?? null;
    out.set(id, { restaurant_id: rid, pos: rid ? posByRid.get(rid) ?? null : null });
  }
  return out;
}
