import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { persistPullToPos, frestoStatus, FRESTO_DRY_RUN } from "@/lib/integrations/pos/fresto";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

// POST { entity, date_from, date_to?, dry_run? } → backfill Fresto orderlines + Z Reports
// into eod_pos for every date in the range (inclusive). Returns per-day summary.
//
// Auth: requires an authenticated user (Vercel edge runtime enforces via supabaseServer).

const RESTAURANT_ID_BY_ENTITY: Record<string, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
};

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > 200) break; // hard cap — 6-month backfill safety
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const entity = String(body.entity || "").toUpperCase() as EntityCode;
    const date_from = String(body.date_from || "").slice(0, 10);
    const date_to = String(body.date_to || date_from).slice(0, 10);
    if (!entity || !["IFL", "BM", "BBH"].includes(entity)) return NextResponse.json({ ok: false, error: "entity required (IFL|BM|BBH)" }, { status: 400 });
    if (!date_from) return NextResponse.json({ ok: false, error: "date_from required (YYYY-MM-DD)" }, { status: 400 });

    if (frestoStatus(entity) !== "connected") {
      return NextResponse.json({ ok: false, error: `no Fresto credentials for ${entity} — set FRESTO_CLIENT_ID_${entity} + FRESTO_CLIENT_SECRET_${entity}` }, { status: 400 });
    }
    const restaurant_id = RESTAURANT_ID_BY_ENTITY[entity];
    if (!restaurant_id) return NextResponse.json({ ok: false, error: `no restaurant_id mapped for ${entity}` }, { status: 400 });

    const sb = supabaseServer();
    const { data: userRes } = await sb.auth.getUser();
    const uid = userRes?.user?.id || null;

    const dates = eachDate(date_from, date_to);
    if (!dates.length) return NextResponse.json({ ok: false, error: "empty date range" }, { status: 400 });

    const summary: Array<{ date: string; ok: boolean; eod_pos_id?: string; existed?: boolean; error?: string }> = [];
    let pulled = 0, skipped = 0, failed = 0;
    for (const date of dates) {
      try {
        const res = await persistPullToPos({ entity, restaurant_id, date, imported_by: uid });
        if (!res) { summary.push({ date, ok: false, error: "no data for date" }); skipped++; continue; }
        summary.push({ date, ok: true, eod_pos_id: res.id, existed: res.existed });
        if (res.existed) skipped++; else pulled++;
      } catch (e: any) {
        summary.push({ date, ok: false, error: e?.message || String(e) });
        failed++;
      }
    }

    // Audit
    await sb.from("assistant_actions").insert({
      user_id: uid,
      action_kind: "pos_sync",
      action_type: "fresto.sync.backfill",
      entity_code: entity,
      target_table: "eod_pos",
      payload: { date_from, date_to, days: dates.length, pulled, skipped, failed, dry_run: FRESTO_DRY_RUN() },
      reversible: false,
    });

    return NextResponse.json({ ok: true, entity, restaurant_id, days: dates.length, pulled, skipped, failed, dry_run: FRESTO_DRY_RUN(), summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
