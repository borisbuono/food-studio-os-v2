import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized, startRun, finishRun } from "@/lib/cron/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Rebuild eod_accounting rows from the VERIFIED eod_pos basis.
//
// State that prompted this (2026-09-21): eod_accounting stops at 2026-08-13
// for BM and 2026-07-05 for Taller, and the five BM August rows that do exist
// carry revenue = NULL. eod_pos has 31 BM August days.
// /api/finance/eod/create-accounting-from-pos only ever seeds ONE day, from a
// click. Nothing walked a range.
//
// Rules this honours — all load-bearing:
//   * A row already posted to Holded (holded_synced_at not null) is NEVER
//     touched. Reported as `locked`.
//   * An existing row is only filled when its revenue is NULL — i.e. it never
//     carried a basis. A row whose revenue disagrees with POS is reported as
//     `divergent` with both figures, never overwritten. Accounting stays
//     human-in-the-loop.
//   * The cash-deduction house rule (Fresto Cash line = EOD counting
//     mistakes, not revenue) is applied through the same system deviation row
//     the single-day route writes, gated on
//     restaurants.deduct_pos_cash_from_food.
//   * DRY RUN BY DEFAULT. Pass apply=1 to write.
//
// GET /api/cron/eod-accounting-rebuild?from=2026-08-01&to=2026-09-20&entities=BM,IFL[&apply=1]

const VENUES: Record<string, { restaurant_id: string; label: string }> = {
  BM:  { restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", label: "Bistro Mondo" },
  IFL: { restaurant_id: "ca83e06f-a24d-43d7-bce4-57ac341d190f", label: "Taller Sa Penya" },
};

export async function GET(req: NextRequest) {
  const auth = await cronAuthorized(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = String(url.searchParams.get("from") || "");
  const to = String(url.searchParams.get("to") || "");
  const apply = url.searchParams.get("apply") === "1";
  const entities = String(url.searchParams.get("entities") || "BM,IFL").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return NextResponse.json({ ok: false, error: "from/to required as ISO dates, to >= from" }, { status: 400 });
  }

  const { supabaseServer } = await import("@/lib/supabaseServer");
  const sb = supabaseServer();
  const runId = await startRun("eod-accounting-rebuild", auth.who, { from, to, entities, apply });
  const perVenue: any[] = [];

  try {
    for (const code of entities) {
      const v = VENUES[code];
      if (!v) { perVenue.push({ entity: code, error: "unknown entity" }); continue; }

      const [posQ, acctQ, restQ] = await Promise.all([
        sb.from("eod_pos")
          .select("id,date,guests,guests_daily,covers,food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur,cash_declared_eur")
          .eq("restaurant_id", v.restaurant_id).eq("source", "fresto")
          .gte("date", from).lte("date", to).order("date"),
        sb.from("eod_accounting")
          .select("id,report_date,revenue,holded_synced_at,eod_pos_id")
          .eq("restaurant_id", v.restaurant_id)
          .gte("report_date", from).lte("report_date", to),
        sb.from("restaurants").select("deduct_pos_cash_from_food").eq("id", v.restaurant_id).maybeSingle(),
      ]);
      if (posQ.error) { perVenue.push({ entity: code, error: "pos read: " + posQ.error.message }); continue; }
      const deductCash: boolean = restQ.data?.deduct_pos_cash_from_food !== false;
      const acctByDate = new Map<string, any>((acctQ.data || []).map((r: any) => [String(r.report_date), r]));

      const created: string[] = [];
      const seeded: string[] = [];
      const locked: string[] = [];
      const divergent: Array<{ date: string; acct: number; pos: number }> = [];
      const unchanged: string[] = [];
      const errors: Array<{ date: string; error: string }> = [];

      for (const pos of (posQ.data || []) as any[]) {
        const date = String(pos.date);
        const revenue = Number(pos.total_gross_eur || 0);
        const row = {
          restaurant_id: v.restaurant_id,
          report_date: date,
          eod_pos_id: pos.id,
          actual_covers: Number(pos.guests ?? pos.guests_daily ?? pos.covers ?? 0) || 0,
          revenue,
          revenue_food: Number(pos.food_net_eur || 0),
          revenue_wine: Number(pos.wine_net_eur || 0),
          revenue_bar: Number(pos.bar_net_eur || 0) + Number(pos.softdrinks_net_eur || 0),
          revenue_tips: Number(pos.tips_eur || 0),
        };
        const existing = acctByDate.get(date);

        try {
          if (!existing) {
            created.push(date);
            if (apply) {
              const ins = await sb.from("eod_accounting").insert(row).select("id").single();
              if (ins.error) throw new Error(ins.error.message);
              if (deductCash) await ensureSystemCashDeduction(sb, pos, ins.data.id);
            }
            continue;
          }
          if (existing.holded_synced_at) { locked.push(date); continue; }
          if (existing.revenue == null) {
            seeded.push(date);
            if (apply) {
              const upd = await sb.from("eod_accounting").update(row).eq("id", existing.id);
              if (upd.error) throw new Error(upd.error.message);
              if (deductCash) await ensureSystemCashDeduction(sb, pos, existing.id);
            }
            continue;
          }
          if (Math.abs(Number(existing.revenue) - revenue) > 0.01) {
            divergent.push({ date, acct: Number(existing.revenue), pos: revenue });
          } else {
            unchanged.push(date);
            if (apply && !existing.eod_pos_id) await sb.from("eod_accounting").update({ eod_pos_id: pos.id }).eq("id", existing.id);
          }
        } catch (e: any) {
          errors.push({ date, error: String(e?.message || e).slice(0, 200) });
        }
      }

      perVenue.push({
        entity: code, label: v.label, pos_days: (posQ.data || []).length,
        cash_deduction: deductCash,
        created: created.length, seeded: seeded.length, locked: locked.length,
        unchanged: unchanged.length, divergent, errors,
        created_dates: created, seeded_dates: seeded,
      });
    }

    const out = { from, to, applied: apply, per_venue: perVenue };
    await finishRun(runId, !perVenue.some((p) => p.errors?.length), out);
    return NextResponse.json({ ok: true, ...out, note: apply ? "written" : "dry run — pass apply=1 to write" });
  } catch (e: any) {
    await finishRun(runId, false, { per_venue: perVenue }, String(e?.message || e).slice(0, 400));
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// Mirror of the single-day route's helper — same category, same sign, same
// idempotency guard, so the two paths can never produce two deviations.
async function ensureSystemCashDeduction(sb: any, pos: any, acctId: string) {
  const cash = Number(pos.cash_declared_eur || 0);
  if (!(cash > 0)) return;
  const existing = await sb.from("eod_deviations")
    .select("id").eq("eod_pos_id", pos.id).eq("is_system", true).eq("category", "cash_deficit").maybeSingle();
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
