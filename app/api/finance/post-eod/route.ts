import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAccountingAdapter } from "@/lib/integrations/registry";
import { eodLinesForEntity } from "@/lib/integrations/accounting/holded";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entity = body.entity as EntityCode;
    if (!entity || !["IFL", "BM", "BBH"].includes(entity)) return NextResponse.json({ ok: false, error: "entity required" }, { status: 400 });
    const date = body.date as string;
    if (!date) return NextResponse.json({ ok: false, error: "date required" }, { status: 400 });
    const totals = { food: +(body.food || 0), wine: +(body.wine || 0), bar: +(body.bar || 0), softdrinks: +(body.softdrinks || 0), tips: +(body.tips || 0) };
    const sum = totals.food + totals.wine + totals.bar + totals.softdrinks + totals.tips;
    if (sum <= 0) return NextResponse.json({ ok: false, error: "no totals" }, { status: 400 });

    const cookieStore = cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { get: (n) => cookieStore.get(n)?.value, set() {}, remove() {} },
    });

    // 1) Source-of-truth write FIRST — survives any integration failure
    const { data: row } = await supabase.from("eod_reports").upsert({
      restaurant_id: body.restaurant_id || null,
      report_date: date,
      revenue: sum,
      revenue_food: totals.food,
      revenue_wine: totals.wine,
      revenue_bar: totals.bar + totals.softdrinks,
      actual_covers: +(body.covers || 0),
    }, { onConflict: "restaurant_id,report_date" }).select("id").maybeSingle();

    // 2) Dispatch via the entity's active accounting adapter
    const adapter = getAccountingAdapter(entity);
    const lines = eodLinesForEntity(entity, totals);
    const res = await adapter.postSalesReceipt({ entity, date, description: body.description || `EOD ${date}`, lines });

    return NextResponse.json({
      ok: true, adapter: adapter.name, vendor: adapter.vendor, dryRun: res.dryRun,
      external_id: res.external_id, eod_id: row?.id, totals,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
