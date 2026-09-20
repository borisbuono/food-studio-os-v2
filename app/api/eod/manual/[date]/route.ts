import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, isPrimaryEntity, EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/eod/manual/[date]
//   body: {
//     entity_id: uuid,
//     covers?, guests?, tickets?,
//     food_gross_eur?, wine_gross_eur?, bar_gross_eur?, softdrinks_gross_eur?,
//     tips_eur?, service_charge_eur?,
//     cash_declared_eur?, card_declared_eur?,
//     notes?
//   }
//
// Edit a previously-entered manual EOD. Manager+ only (managers, owners).
// Every patch is captured in assistant_actions as an audit-trail entry —
// the row itself is not versioned, but who changed what and when is.

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}
function nnum(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const MANAGER_PLUS = new Set(["manager", "owner", "gm", "director", "operator", "admin"]);

async function resolveRestaurantId(sb: ReturnType<typeof supabaseServer>, entityId: string): Promise<string | null> {
  if (isPrimaryEntity(entityId)) {
    const mapped = ENTITY_TO_RESTAURANT[entityId as EntityKey];
    if (mapped) return mapped;
  }
  const { data } = await sb
    .from("restaurants").select("id").eq("entity_id", entityId).limit(1).maybeSingle();
  return (data?.id as string) || null;
}

// Manager+ gate: any active membership on this entity whose role is in
// MANAGER_PLUS, OR any owner membership across the org (owners see all).
async function isManagerPlus(sb: ReturnType<typeof supabaseServer>, userId: string, entityId: string): Promise<boolean> {
  const { data: tmRows } = await sb
    .from("team_members").select("id, status").eq("auth_user_id", userId);
  const personIds = (tmRows || [])
    .filter((r: any) => r.status !== "archived")
    .map((r: any) => r.id as string);
  if (!personIds.length) return false;

  const { data: mems } = await sb
    .from("memberships")
    .select("entity_id, role, status")
    .in("person_id", personIds)
    .eq("status", "active");
  for (const m of mems || []) {
    const role = String((m as any).role || "").toLowerCase();
    if (role === "owner") return true;
    if ((m as any).entity_id === entityId && MANAGER_PLUS.has(role)) return true;
  }
  return false;
}

export async function PATCH(req: NextRequest, { params }: { params: { date: string } }) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const date = String(params?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "invalid date (path)" }, { status: 400 });
  }

  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const entityId = String(body?.entity_id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    return NextResponse.json({ ok: false, error: "entity_id (body) required" }, { status: 400 });
  }

  const canEdit = await isManagerPlus(sb, user.id, entityId);
  if (!canEdit) return NextResponse.json({ ok: false, error: "manager+ role required for back-fill / edit" }, { status: 403 });

  const rid = await resolveRestaurantId(sb, entityId);
  if (!rid) return NextResponse.json({ ok: false, error: "no restaurant row for entity_id" }, { status: 400 });

  const { data: existing } = await sb
    .from("eod_pos")
    .select("id, food_net_eur, wine_net_eur, bar_net_eur, softdrinks_net_eur, tips_eur, service_charge_eur, cash_declared_eur, card_declared_eur, covers, guests, tickets, raw_payload")
    .eq("restaurant_id", rid).eq("date", date).eq("source", "manual")
    .maybeSingle();
  if (!existing) return NextResponse.json({ ok: false, error: "no manual eod row for this date" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  const set = <K extends string>(k: K, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set("food_net_eur",      num(body?.food_gross_eur));
  set("wine_net_eur",      num(body?.wine_gross_eur));
  set("bar_net_eur",       num(body?.bar_gross_eur));
  set("softdrinks_net_eur", num(body?.softdrinks_gross_eur));
  set("tips_eur",          num(body?.tips_eur));
  set("service_charge_eur", num(body?.service_charge_eur));
  set("cash_declared_eur", num(body?.cash_declared_eur));
  set("card_declared_eur", num(body?.card_declared_eur));
  set("covers",  nnum(body?.covers));
  set("guests",  nnum(body?.guests));
  set("tickets", nnum(body?.tickets));

  // Recompute total_gross_eur from the merged row (existing + patch).
  const merged = { ...existing, ...patch } as any;
  const total =
    Number(merged.food_net_eur || 0) +
    Number(merged.wine_net_eur || 0) +
    Number(merged.bar_net_eur || 0) +
    Number(merged.softdrinks_net_eur || 0) +
    Number(merged.tips_eur || 0) +
    Number(merged.service_charge_eur || 0);
  patch["total_gross_eur"] = total;

  if (body?.notes !== undefined) {
    const rp = (existing as any).raw_payload && typeof (existing as any).raw_payload === "object"
      ? { ...(existing as any).raw_payload } : {};
    rp.notes = body.notes == null ? null : String(body.notes).slice(0, 2000);
    rp.edited_by = user.id;
    rp.edited_at = new Date().toISOString();
    patch["raw_payload"] = rp;
  }

  if (Object.keys(patch).length === 1 /* only total_gross_eur */ && body?.notes === undefined) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const upd = await sb.from("eod_pos").update(patch).eq("id", (existing as any).id).select("id").single();
  if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });

  try {
    await sb.from("assistant_actions").insert({
      user_id: user.id,
      action_kind: "eod_manual_patch",
      action_type: "eod.manual.patch",
      target_table: "eod_pos",
      target_id: (existing as any).id,
      payload: { entity_id: entityId, restaurant_id: rid, date, patch, notes: body?.notes ?? null },
      reversible: false,
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, id: (existing as any).id, date, total_gross_eur: total });
}
