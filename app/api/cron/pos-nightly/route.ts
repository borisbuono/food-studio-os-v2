import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { persistPullToPos, frestoStatus, FRESTO_DRY_RUN } from "@/lib/integrations/pos/fresto";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The nightly work can take a while when we're catching up a multi-day gap
// (two venues x N days x live API). Bump above the default 10s budget so
// Vercel doesn't kill us mid-backfill.
export const maxDuration = 300;

// Nightly Fresto → eod_pos sync. Boris walk 2026-08-31 root cause: the
// backfill endpoint (POST /api/integrations/fresto/sync) shipped, but no
// cron ever hit it — the last successful pull was 2026-08-21. So the row
// grew stale silently and the Studio tile read "€170 · last close" without
// a date to signal how stale it was.
//
// Design decisions:
//   • Self-healing: don't rely on a "yesterday only" pull. Each run reads
//     the newest eod_pos date per venue and back-fills every missing day
//     up to yesterday (Madrid). If we skip a night for any reason, the
//     next run catches up.
//   • Look-back cap: hard-limited to 30 days so a broken cron doesn't
//     silently accumulate a 6-month backlog we'd rather notice.
//   • Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
//     Also allowed: an authenticated Studio user (Boris) hitting the
//     route directly from the browser.
//   • Idempotent update: persistPullToPos upserts on (restaurant_id, date,
//     source=fresto). Existing rows are refreshed with the current API
//     response (tickets, orders_count, tables_count, revenue split, z-span
//     flag). Manually keyed guests are preserved by the writer, never
//     overwritten.
//   • ?force=1 — ignore the "newest row" optimisation and re-pull the
//     whole MAX_LOOKBACK_DAYS window. Used for backfills after a schema
//     change (Boris walk 2026-08-31 tickets/guests split).

const VENUES: Array<{ entity: EntityCode; restaurant_id: string; label: string }> = [
  { entity: "BM",  restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", label: "Bistro Mondo" },
  { entity: "IFL", restaurant_id: "ca83e06f-a24d-43d7-bce4-57ac341d190f", label: "Taller Sa Penya" },
];
const MAX_LOOKBACK_DAYS = 30;

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function isoDaysAgo(base: string, days: number): string {
  const d = new Date(base + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > MAX_LOOKBACK_DAYS + 1) break;
  }
  return out;
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return true;
  // Fall back to an authenticated Supabase session (Boris hitting the URL).
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  return !!userRes?.user;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseServer();
  const today = madridToday();
  // "Yesterday" is the last complete business day we back-fill up to. Boris
  // closes at ~03:00 sometimes; the cron runs at 07:00 UTC (09:00 CET) so
  // yesterday's Z is settled.
  const yesterday = isoDaysAgo(today, 1);
  const lookback_floor = isoDaysAgo(today, MAX_LOOKBACK_DAYS);
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const perVenue: any[] = [];

  for (const v of VENUES) {
    const status = frestoStatus(v.entity);
    if (status !== "connected") {
      perVenue.push({ entity: v.entity, label: v.label, status, skipped: "no-credentials" });
      continue;
    }

    // Newest eod_pos row for this venue (any source, so a manual XLSX still
    // counts and we don't re-pull dates Boris already keyed by hand).
    const { data: newest, error: qerr } = await sb.from("eod_pos")
      .select("date")
      .eq("restaurant_id", v.restaurant_id)
      .order("date", { ascending: false })
      .limit(1);
    if (qerr) {
      perVenue.push({ entity: v.entity, label: v.label, error: "query newest failed: " + qerr.message });
      continue;
    }

    const newestDate = newest?.[0]?.date as string | undefined;
    // Start = day AFTER the newest row we have (self-heal). With ?force=1
    // we ignore this and always pull the whole MAX_LOOKBACK_DAYS window
    // so a schema change (like the tickets/guests split) can be
    // back-propagated in one shot.
    const gapStart = newestDate && !force ? isoDaysAgo(newestDate, -1) : lookback_floor;
    const start = gapStart < lookback_floor ? lookback_floor : gapStart;

    if (start > yesterday) {
      perVenue.push({ entity: v.entity, label: v.label, newest: newestDate, up_to_date: true });
      continue;
    }

    const dates = eachDate(start, yesterday);
    const summary: Array<{ date: string; ok: boolean; existed?: boolean; error?: string; eod_pos_id?: string }> = [];
    let inserted = 0, updated = 0, failed = 0, empty = 0;

    for (const date of dates) {
      try {
        const res = await persistPullToPos({
          entity: v.entity, restaurant_id: v.restaurant_id, date, imported_by: null,
        });
        if (!res) { summary.push({ date, ok: false, error: "no data for date" }); empty++; continue; }
        summary.push({ date, ok: true, existed: res.existed, eod_pos_id: res.id });
        if (res.existed) updated++; else inserted++;
      } catch (e: any) {
        summary.push({ date, ok: false, error: e?.message || String(e) });
        failed++;
      }
    }

    perVenue.push({
      entity: v.entity, label: v.label, newest_before: newestDate,
      backfilled_from: start, backfilled_through: yesterday,
      days: dates.length, inserted, updated, empty, failed, summary,
    });
  }

  // Piggyback: also sweep Gmail for Fresto closing-report emails and
  // parse `Guests: N` into eod_pos.guests where guests_source != 'manual'.
  // We don't add a separate Vercel cron for this (Hobby plan is capped at
  // 3 crons — see the memory note). The scan is a no-op if no Gmail
  // channel is connected.
  let email_scan_ok = false;
  let email_scan_error: string | null = null;
  try {
    const origin = new URL(req.url).origin;
    const r = await fetch(origin + "/api/cron/fresto-email-guests", {
      headers: { ...(process.env.CRON_SECRET ? { authorization: "Bearer " + process.env.CRON_SECRET } : {}) },
    });
    email_scan_ok = r.ok;
    if (!r.ok) email_scan_error = "http " + r.status;
  } catch (e: any) {
    email_scan_error = e?.message || String(e);
  }

  // Audit trail so we can see when the cron ran and what it moved.
  try {
    await sb.from("assistant_actions").insert({
      user_id: null,
      action_kind: "pos_sync",
      action_type: "fresto.cron.nightly",
      entity_code: null,
      target_table: "eod_pos",
      payload: {
        at_madrid: today,
        yesterday,
        dry_run: FRESTO_DRY_RUN(),
        force,
        per_venue: perVenue.map((p) => ({
          entity: p.entity, days: p.days, inserted: p.inserted, updated: p.updated,
          empty: p.empty, failed: p.failed, error: p.error,
          newest_before: p.newest_before, backfilled_through: p.backfilled_through,
        })),
      },
      reversible: false,
    });
  } catch {
    // Audit failures are non-fatal — the sync itself already happened.
  }

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    today_madrid: today,
    yesterday,
    dry_run: FRESTO_DRY_RUN(),
    force,
    email_scan_ok,
    email_scan_error,
    per_venue: perVenue,
  });
}
