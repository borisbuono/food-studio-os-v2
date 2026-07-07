import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// POST { eod_pos_id } → creates (or returns existing) editable eod_accounting row seeded
// from the POS snapshot totals. Boris then edits it via /administrate/finance/eod/new and
// posts it to Holded via /api/finance/post-eod. Deviations are logged separately.
// See memory/pos_vs_accounting_separation.md.
//
// HOUSE RULE (LOCKED 2026-07-07 — memory/eod_posting_cash_deduction_rule.md):
// when we seed an accounting row we ALSO auto-insert a system-generated eod_deviations
// row that deducts the POS Cash line from Food. The Fresto Cash line is orphan cash —
// EOD counting mistakes that Fresto defaults into Food. Real Food revenue = Food − Cash.
// The system deviation is visible + editable (in case of a legit exchange) but cannot
// be deleted. Rule was broken on the 34-day BM backfill (2026-05-26 → 2026-07-03) —
// see 02_Build/decisions/bm_34_day_cash_backfill_correction_2026-07-07.md.
//
// RULE UPDATE (2026-07-07 — supabase/migrations/20260707_restaurant_cash_rule.sql):
// the deduction is now GATED on restaurants.deduct_pos_cash_from_food. Default TRUE
// for IFL + BM (the two venues where the rule is confirmed correct), but venues with
// real cash service can be flipped FALSE from /administrate/finance/setup/[entity].
// When FALSE we skip the auto-insert entirely — no system deviation is created and
// Food revenue stays as the POS reported it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const eod_pos_id = String(body.eod_pos_id || "").trim();
    if (!eod_pos_id) return NextResponse.json({ ok: false, error: "eod_pos_id required" }, { status: 400 });

    const sb = supabaseServer();
    const { data: pos, error: posErr } = await sb
      .from("eod_pos")
      .select("id,restaurant_id,date,covers,food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur,cash_declared_eur")
      .eq("id", eod_pos_id)
      .maybeSingle();
    if (posErr) return NextResponse.json({ ok: false, error: "pos read: " + posErr.message }, { status: 500 });
    if (!pos)   return NextResponse.json({ ok: false, error: "eod_pos not found" }, { status: 404 });

    // Per-restaurant cash-deduction toggle. Default TRUE if the column is missing
    // or the row is not readable (defensive — matches migration default).
    const restQ = await sb.from("restaurants")
      .select("deduct_pos_cash_from_food")
      .eq("id", pos.restaurant_id)
      .maybeSingle();
    const deductCash: boolean = restQ.data?.deduct_pos_cash_from_food !== false;

    // If an accounting row for this venue+day already exists, link it and return.
    const existing = await sb.from("eod_accounting")
      .select("id,eod_pos_id")
      .eq("restaurant_id", pos.restaurant_id)
      .eq("report_date", pos.date)
      .maybeSingle();
    if (existing.data?.id) {
      if (!existing.data.eod_pos_id) {
        await sb.from("eod_accounting").update({ eod_pos_id: pos.id }).eq("id", existing.data.id);
      }
      // Ensure the system cash-deduction row exists for this POS snapshot even if the
      // accounting row was created before this rule shipped — but only when the venue
      // opts into the auto-deduction.
      if (deductCash) await ensureSystemCashDeduction(sb, pos, existing.data.id);
      return NextResponse.json({ ok: true, id: existing.data.id, created: false, cash_deducted: deductCash });
    }

    // Seed accounting record with POS totals. Boris edits from here; deviations are logged
    // against the same eod_pos_id and eod_accounting_id.
    const revenue = Number(pos.total_gross_eur || 0);
    const ins = await sb.from("eod_accounting").insert({
      restaurant_id: pos.restaurant_id,
      report_date: pos.date,
      eod_pos_id: pos.id,
      actual_covers: pos.covers || 0,
      revenue,
      revenue_food: pos.food_net_eur || 0,
      revenue_wine: pos.wine_net_eur || 0,
      revenue_bar:  (pos.bar_net_eur || 0) + (pos.softdrinks_net_eur || 0),
    }).select("id").single();
    if (ins.error) return NextResponse.json({ ok: false, error: "acct insert: " + ins.error.message }, { status: 500 });

    // Auto-insert the SYSTEM cash-deficit deviation (house rule) — gated per restaurant.
    if (deductCash) await ensureSystemCashDeduction(sb, pos, ins.data.id);

    return NextResponse.json({ ok: true, id: ins.data.id, created: true, cash_deducted: deductCash });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// Idempotent: creates the system cash-deficit deviation for this eod_pos_id + accounting
// pair if one does not already exist. Amount = −cash_declared_eur (negative = reduces
// Food revenue). Skipped when cash_declared is zero.
async function ensureSystemCashDeduction(sb: ReturnType<typeof supabaseServer>, pos: any, acctId: string) {
  const cash = Number(pos.cash_declared_eur || 0);
  if (!(cash > 0)) return;

  const existing = await sb.from("eod_deviations")
    .select("id")
    .eq("eod_pos_id", pos.id)
    .eq("is_system", true)
    .eq("category", "cash_deficit")
    .maybeSingle();
  if (existing.data?.id) return;

  await sb.from("eod_deviations").insert({
    eod_pos_id: pos.id,
    eod_accounting_id: acctId,
    category: "cash_deficit",
    affected_line: "food",
    amount_eur: -cash,
    description: "Fresto Cash line deducted from Food (house rule — cash line = EOD mistakes, not revenue)",
    is_system: true,
    created_by: null,
  });
}
