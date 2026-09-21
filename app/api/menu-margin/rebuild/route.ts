import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { refreshMenuMargin } from "@/lib/recipes/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/menu-margin/rebuild
//
// Refreshes menu_dish_costing rows from the fresh `recipes.cost_per_portion_eur`
// column (computed from purchase_lines). This is the "publish" step — a
// real cost lands on /studio/money/menu-margin only after this runs.
// Also runs automatically after invoice ingest and nightly
// (/api/recipes/compute-all-entities). Rows without a matched recipe are
// left alone — scripts/compute_menu_margin.py owns them.
//
// `updated` now counts rows Postgres actually returned — before the
// 2026-09-21 write policy, RLS matched zero rows and this reported success.

export async function POST() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const res = await refreshMenuMargin(sb);
  if (res.error) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, rows: res.rows, updated: res.updated });
}
