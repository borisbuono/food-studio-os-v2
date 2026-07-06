import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// POST { eod_pos_id } → creates (or returns existing) editable eod_accounting row seeded
// from the POS snapshot totals. Boris then edits it via /administrate/finance/eod/new and
// posts it to Holded via /api/finance/post-eod. Deviations are logged separately.
// See memory/pos_vs_accounting_separation.md.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const eod_pos_id = String(body.eod_pos_id || "").trim();
    if (!eod_pos_id) return NextResponse.json({ ok: false, error: "eod_pos_id required" }, { status: 400 });

    const sb = supabaseServer();
    const { data: pos, error: posErr } = await sb
      .from("eod_pos")
      .select("id,restaurant_id,date,covers,food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur")
      .eq("id", eod_pos_id)
      .maybeSingle();
    if (posErr) return NextResponse.json({ ok: false, error: "pos read: " + posErr.message }, { status: 500 });
    if (!pos)   return NextResponse.json({ ok: false, error: "eod_pos not found" }, { status: 404 });

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
      return NextResponse.json({ ok: true, id: existing.data.id, created: false });
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

    return NextResponse.json({ ok: true, id: ins.data.id, created: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
