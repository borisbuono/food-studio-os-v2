import { NextRequest, NextResponse } from "next/server";
import { holdedAdapter, eodLinesForEntity } from "@/lib/integrations/accounting/holded";
import type { EntityCode } from "@/lib/integrations/types";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const VALID_ENTITY = new Set<EntityCode>(["IFL", "BM", "BBH"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entity = body.entity as EntityCode;
    const date = String(body.date || "").trim();           // YYYY-MM-DD
    const restaurant_id = String(body.restaurant_id || "").trim();
    const covers = Math.max(0, Number(body.covers || 0));
    const totals = {
      food:       Math.max(0, Number(body.food || 0)),
      wine:       Math.max(0, Number(body.wine || 0)),
      bar:        Math.max(0, Number(body.bar || 0)),
      softdrinks: Math.max(0, Number(body.softdrinks || 0)),
      tips:       Math.max(0, Number(body.tips || 0)),
    };
    const description = String(body.description || `EOD ${date}`);

    if (!VALID_ENTITY.has(entity)) return NextResponse.json({ ok: false, error: "bad entity" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
    if (!restaurant_id) return NextResponse.json({ ok: false, error: "bad restaurant" }, { status: 400 });
    const totalNet = Object.values(totals).reduce((a, b) => a + b, 0);
    if (totalNet <= 0) return NextResponse.json({ ok: false, error: "totals are zero" }, { status: 400 });

    const lines = eodLinesForEntity(entity, totals);
    const totalVat = lines.reduce((a, l) => a + (l.net_eur * l.vat_rate) / 100, 0);
    const gross = totalNet + totalVat;

    // 1) Persist the EOD row in our own table FIRST (source of truth even if Holded errors)
    const supabase = supabaseServer();
    const { data: row, error: eodErr } = await supabase
      .from("eod_reports")
      .upsert(
        {
          restaurant_id,
          report_date: date,
          actual_covers: covers,
          revenue: gross,
          revenue_food: totals.food + (totals.food * (lines.find((l) => l.description === "Food")?.vat_rate || 0)) / 100,
          revenue_wine: totals.wine + (totals.wine * (lines.find((l) => l.description === "Wine")?.vat_rate || 0)) / 100,
          revenue_bar:  totals.bar  + (totals.bar  * (lines.find((l) => l.description === "Bar")?.vat_rate  || 0)) / 100,
        },
        { onConflict: "restaurant_id,report_date" } as any
      )
      .select("id")
      .maybeSingle();
    if (eodErr) return NextResponse.json({ ok: false, error: "eod write: " + eodErr.message }, { status: 500 });

    // 2) POST to Holded via the adapter — dry-run by default
    const res = await holdedAdapter.postSalesReceipt({ entity, date, description, lines });

    return NextResponse.json({
      ok: true,
      dryRun: process.env.FS_HOLDED_DRY_RUN !== "false",
      holded_external_id: res.external_id,
      eod_id: row?.id || null,
      totals: { netByLine: lines, totalNet, totalVat, gross },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
