import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, isPrimaryEntity, EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/eod/manual
//   body: {
//     entity_id: uuid,
//     date: "YYYY-MM-DD"    (trading date),
//     covers?: number,
//     guests?: number,
//     tickets?: number,
//     food_gross_eur, wine_gross_eur, bar_gross_eur, softdrinks_gross_eur,
//     tips_eur, service_charge_eur?,
//     cash_declared_eur, card_declared_eur,
//     notes?: string
//   }
//
// Runway d2 (2026-09-20): manual EOD entry mode for venues without an
// auto-pull POS adapter (Amsterdam launch bridge). Writes an eod_pos row
// with source='manual' + imported_by=auth.uid. Idempotent upsert on the
// (restaurant_id, date, source='manual') unique index — a second POST for
// the same day overwrites the first (same user).
//
// Duality rule (memory/pos_vs_accounting_separation.md): the POS row is
// still immutable in Boris's terms — never auto-populated from any other
// source, and the accounting row remains a separate write path. Manual
// means manual.

function num(v: unknown, def = 0): number {
  if (v == null || v === "") return def;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : def;
}
function nnum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function resolveRestaurantId(sb: ReturnType<typeof supabaseServer>, entityId: string): Promise<string | null> {
  // Primary three entities have a hardcoded rid map (SSR-fast). Anything
  // else falls back to a DB lookup by entities.id → restaurants.entity_id.
  if (isPrimaryEntity(entityId)) {
    const mapped = ENTITY_TO_RESTAURANT[entityId as EntityKey];
    if (mapped) return mapped;
  }
  const { data } = await sb
    .from("restaurants")
    .select("id")
    .eq("entity_id", entityId)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) || null;
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const entityId = String(body?.entity_id || "").trim();
  const date = String(body?.date || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    return NextResponse.json({ ok: false, error: "entity_id must be a uuid" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD (trading date)" }, { status: 400 });
  }

  const rid = await resolveRestaurantId(sb, entityId);
  if (!rid) return NextResponse.json({ ok: false, error: "no restaurant row for entity_id" }, { status: 400 });

  const food   = num(body?.food_gross_eur);
  const wine   = num(body?.wine_gross_eur);
  const bar    = num(body?.bar_gross_eur);
  const softs  = num(body?.softdrinks_gross_eur);
  const tips   = num(body?.tips_eur);
  const service = num(body?.service_charge_eur);
  const cash   = num(body?.cash_declared_eur);
  const card   = num(body?.card_declared_eur);
  const covers = nnum(body?.covers);
  const guests = nnum(body?.guests);
  const tickets = nnum(body?.tickets);
  const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;

  // Sum gross across all revenue lines. In manual mode the operator keys
  // gross (VAT-inclusive) figures the way they see them on paper; we do
  // not attempt to derive net without a VAT split — leave *_net_eur zero
  // and use the *_net_eur columns to store the same gross values so the
  // existing views (v_operational_pnl, house landing) pick them up.
  //
  // Rationale: the schema was authored for Fresto (which returns net); the
  // legacy column names carry _net_eur, but for manual mode we store gross
  // there because tax splitting is done downstream when Boris books it to
  // Holded via the accounting path (unchanged by this endpoint).
  const totalGross = food + wine + bar + softs + tips + service;

  const now = new Date().toISOString();

  // Upsert on the (restaurant_id, date, source) unique index — a fresh
  // POST for the same day replaces the previous manual entry.
  const upsertRow: Record<string, unknown> = {
    restaurant_id: rid,
    date,
    source: "manual",
    source_ref: "manual-eod-entry",
    covers,
    tickets,
    guests,
    guests_source: guests != null ? "manual" : null,
    guests_keyed_by: guests != null ? user.id : null,
    guests_keyed_at: guests != null ? now : null,
    food_net_eur: food,
    wine_net_eur: wine,
    bar_net_eur: bar,
    softdrinks_net_eur: softs,
    tips_eur: tips,
    service_charge_eur: service,
    cash_declared_eur: cash,
    card_declared_eur: card,
    total_gross_eur: totalGross,
    imported_at: now,
    imported_by: user.id,
    raw_payload: { manual: true, notes, keyed_by_user: user.id, entity_id: entityId },
  };

  const up = await sb
    .from("eod_pos")
    .upsert(upsertRow, { onConflict: "restaurant_id,date,source" })
    .select("id")
    .single();
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  // Audit trail — small enough that every manual key is worth logging.
  try {
    await sb.from("assistant_actions").insert({
      user_id: user.id,
      action_kind: "eod_manual_upsert",
      action_type: "eod.manual.upsert",
      target_table: "eod_pos",
      target_id: up.data.id,
      payload: { entity_id: entityId, restaurant_id: rid, date, total_gross_eur: totalGross, notes },
      reversible: true,
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    id: up.data.id,
    entity_id: entityId,
    restaurant_id: rid,
    date,
    total_gross_eur: totalGross,
    source: "manual",
  });
}
