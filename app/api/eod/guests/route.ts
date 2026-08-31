import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/eod/guests
//   body: { restaurant_id: string; date: "YYYY-MM-DD"; guests: number|null }
//
// Manual guest key for a Fresto eod_pos row. Boris walk 2026-08-31 18:15
// CET: Fresto has no guest field so guests come from either the closing-
// report email ("Guests: N") or Boris keying them here. Manual key TRUMPS
// email parse — the writer never overwrites guests_source='manual' rows.
//
// Auth: any authenticated user with a membership on the venue's entity
// can write. The Studio-scope surface guards the UI too, but we enforce
// server-side because the endpoint is callable directly.

const RID_TO_ENTITY_CODE: Record<string, string> = {
  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259": "BM",
  "ca83e06f-a24d-43d7-bce4-57ac341d190f": "IFL",
};

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const restaurant_id = String(body?.restaurant_id || "");
  const date = String(body?.date || "");
  const guestsRaw = body?.guests;
  const guests = guestsRaw == null || guestsRaw === "" ? null : Math.round(Number(guestsRaw));
  if (!restaurant_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "restaurant_id + date required" }, { status: 400 });
  }
  if (guests != null && (!Number.isFinite(guests) || guests < 0 || guests > 9999)) {
    return NextResponse.json({ ok: false, error: "guests must be 0..9999 or null" }, { status: 400 });
  }

  // Membership guard — the user must belong to the venue's entity, or
  // be the owner (multi-role). We derive the entity_code from the RID
  // map and check public.entity_memberships. Any active membership on
  // the entity is enough — we're keying a metric, not editing money.
  const entityCode = RID_TO_ENTITY_CODE[restaurant_id];
  if (!entityCode) return NextResponse.json({ ok: false, error: "unknown restaurant_id" }, { status: 400 });

  // Look up the entity row to get its uuid — memberships are keyed by
  // entity_id (uuid), not by code.
  const { data: entRow } = await sb
    .from("entities")
    .select("id, name")
    .eq("name", entityCode === "BM" ? "Bistro Mondo" : "Taller Sa Penya")
    .maybeSingle();
  if (!entRow?.id) return NextResponse.json({ ok: false, error: "entity not found" }, { status: 400 });

  const { data: mem } = await sb
    .from("entity_memberships")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("entity_id", entRow.id)
    .maybeSingle();
  if (!mem) {
    // Owner escape hatch — a user with an owner-role membership on ANY
    // entity is considered global. Matches getMyMembershipContext.
    const { data: ownerAny } = await sb
      .from("entity_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .limit(1);
    if (!ownerAny || !ownerAny.length) return NextResponse.json({ ok: false, error: "no membership on venue" }, { status: 403 });
  }

  // Find the eod_pos row. If it doesn't exist yet (no z closed) we
  // create a stub so Boris can key guests ahead of the API pull — the
  // nightly cron will upsert the POS fields on top later.
  const { data: existing } = await sb.from("eod_pos")
    .select("id, guests_source")
    .eq("restaurant_id", restaurant_id)
    .eq("date", date)
    .eq("source", "fresto")
    .maybeSingle();

  const now = new Date().toISOString();
  let id: string;
  if (existing?.id) {
    const upd = await sb.from("eod_pos").update({
      guests,
      guests_source: guests == null ? null : "manual",
      guests_keyed_by: guests == null ? null : user.id,
      guests_keyed_at: guests == null ? null : now,
    }).eq("id", existing.id).select("id").single();
    if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    id = upd.data.id;
  } else {
    const ins = await sb.from("eod_pos").insert({
      restaurant_id, date, source: "fresto", source_ref: "manual-guests-stub",
      covers: null, tickets: null, orders_count: null, tables_count: null,
      food_net_eur: 0, wine_net_eur: 0, bar_net_eur: 0, softdrinks_net_eur: 0,
      tips_eur: 0, service_charge_eur: 0, cash_declared_eur: 0, card_declared_eur: 0,
      total_gross_eur: 0,
      guests,
      guests_source: guests == null ? null : "manual",
      guests_keyed_by: guests == null ? null : user.id,
      guests_keyed_at: guests == null ? null : now,
      imported_by: user.id,
      raw_payload: { stub: true, keyed_by_user: user.id },
    }).select("id").single();
    if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 });
    id = ins.data.id;
  }

  // Audit trail — Boris's manual keys are a small class of hand-edits
  // and it's worth being able to reconstruct who/when.
  try {
    await sb.from("assistant_actions").insert({
      user_id: user.id,
      action_kind: "eod_guests_manual",
      action_type: "eod.guests.manual_key",
      entity_code: entityCode,
      target_table: "eod_pos",
      target_id: id,
      payload: { restaurant_id, date, guests },
      reversible: true,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true, id, guests, guests_source: guests == null ? null : "manual" });
}
