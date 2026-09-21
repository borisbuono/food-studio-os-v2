import { NextRequest, NextResponse } from "next/server";
import { persistPullToPos, frestoStatus, refreshFrestoMasters, FRESTO_DRY_RUN } from "@/lib/integrations/pos/fresto";
import { cronAuthorized, cronDb, startRun, finishRun } from "@/lib/cron/heartbeat";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Range replay of the Fresto day surface — orderlines, orders, z-reports,
// bookings, bookings/daily, income centres and the derived eod_pos row — for
// any window, on demand.
//
// Why: pos-nightly only walks FORWARD from the newest eod_pos row, capped at
// 30 days. Holes BEHIND that row (BM August had orderlines for 19 of 31 days)
// can never be filled by it. This route fills them. Idempotent: every writer
// upserts, so re-running a day is safe.
//
// GET /api/cron/fresto-backfill?from=2026-08-01&to=2026-08-31&entities=BM,IFL&masters=1
//   from, to       inclusive ISO dates (max 62 days per call — 300s Vercel cap)
//   entities       default BM,IFL
//   masters=1      also refresh tables/staff/menu/salepoint masters
//   skip_existing=1  only pull days with no eod_pos row yet
// Auth: Bearer CRON_SECRET, or a signed-in Studio session.

const VENUES: Record<string, { entity: EntityCode; restaurant_id: string; label: string }> = {
  BM:  { entity: "BM",  restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", label: "Bistro Mondo" },
  IFL: { entity: "IFL", restaurant_id: "ca83e06f-a24d-43d7-bce4-57ac341d190f", label: "Taller Sa Penya" },
};
const MAX_DAYS = 62;

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const s = new Date(from + "T00:00:00Z"), e = new Date(to + "T00:00:00Z");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  for (let d = s; d <= e && out.length < MAX_DAYS; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await cronAuthorized(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = String(url.searchParams.get("from") || "");
  const to = String(url.searchParams.get("to") || "");
  const entities = String(url.searchParams.get("entities") || "BM,IFL").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const wantMasters = url.searchParams.get("masters") === "1";
  const skipExisting = url.searchParams.get("skip_existing") === "1";

  const dates = eachDate(from, to);
  if (!dates.length) {
    return NextResponse.json({ ok: false, error: "from/to required, ISO dates, to >= from, max " + MAX_DAYS + " days" }, { status: 400 });
  }

  const runId = await startRun("fresto-backfill", auth.who, { from, to, entities, days: dates.length });
  const { sb, mode: dbMode } = cronDb();
  const perVenue: any[] = [];

  try {
    for (const code of entities) {
      const v = VENUES[code];
      if (!v) { perVenue.push({ entity: code, error: "unknown entity" }); continue; }
      if (frestoStatus(v.entity) !== "connected") { perVenue.push({ entity: code, skipped: "no-credentials" }); continue; }

      let existing = new Set<string>();
      if (skipExisting) {
        const { data } = await sb.from("eod_pos")
          .select("date").eq("restaurant_id", v.restaurant_id)
          .gte("date", dates[0]).lte("date", dates[dates.length - 1]);
        existing = new Set((data || []).map((r: any) => String(r.date)));
      }

      let inserted = 0, updated = 0, empty = 0, failed = 0, skipped = 0;
      const errors: Array<{ date: string; error: string }> = [];
      for (const date of dates) {
        if (skipExisting && existing.has(date)) { skipped++; continue; }
        try {
          const res = await persistPullToPos({ entity: v.entity, restaurant_id: v.restaurant_id, date, imported_by: null });
          if (!res) { empty++; continue; }
          if (res.existed) updated++; else inserted++;
        } catch (e: any) {
          failed++;
          if (errors.length < 10) errors.push({ date, error: String(e?.message || e).slice(0, 200) });
        }
      }

      let masters: any = null;
      if (wantMasters) {
        try { masters = await refreshFrestoMasters(v.entity); }
        catch (e: any) { masters = { error: String(e?.message || e).slice(0, 200) }; }
      }

      perVenue.push({ entity: code, label: v.label, days: dates.length, inserted, updated, empty, failed, skipped, errors, masters });
    }

    const summary = { from, to, db: dbMode, auth: auth.who, dry_run: FRESTO_DRY_RUN(), per_venue: perVenue };
    await finishRun(runId, !perVenue.some((p) => p.failed), summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: any) {
    await finishRun(runId, false, { per_venue: perVenue }, String(e?.message || e).slice(0, 400));
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
