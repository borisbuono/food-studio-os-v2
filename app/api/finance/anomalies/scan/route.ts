import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { detectAll, type EntityCode } from "@/lib/finance/anomaly-detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/anomalies/scan
//
// Body: { entity_code: "IFL" | "BM" | "BBH" }  — single entity
//    or  { entities: ["IFL","BM","BBH"] }      — batch, used by the nightly job
//
// Nightly cron target: POST with { entities: ["IFL","BM","BBH"] }.
// The route is idempotent — re-running just refreshes last_seen_date on
// existing rows and inserts new ones for anomalies that only just appeared.

const VALID: EntityCode[] = ["IFL", "BM", "BBH"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const entities: EntityCode[] = Array.isArray(body?.entities)
      ? (body.entities as string[]).filter((e): e is EntityCode => VALID.includes(e as EntityCode))
      : body?.entity_code && VALID.includes(body.entity_code)
        ? [body.entity_code as EntityCode]
        : [];
    if (!entities.length) {
      return NextResponse.json({ ok: false, error: "provide entity_code or entities[]" }, { status: 400 });
    }
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const uid = u.user?.id || null;

    const results = await Promise.all(entities.map((e) => detectAll(e, { user_id: uid })));
    const summary = entities.map((e, i) => ({
      entity_code: e,
      upserted: results[i].upserted,
      by_kind: results[i].by_kind,
    }));
    const total = results.reduce((a, r) => a + r.upserted, 0);
    return NextResponse.json({ ok: true, total, entities: summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// GET /api/finance/anomalies/scan?entity=IFL — open rows for the FAB / tiles.
// Returns the top-N most severe unresolved anomalies for the entity.
export async function GET(req: NextRequest) {
  const entity = (req.nextUrl.searchParams.get("entity") || "").toUpperCase();
  if (!VALID.includes(entity as EntityCode)) {
    return NextResponse.json({ ok: false, error: "entity=? required (IFL|BM|BBH)" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { data, error } = await sb.from("v_finance_anomalies_open")
    .select("id,entity_code,kind,description,severity,detected_at,first_seen_date,last_seen_date,meta,source_table,source_id")
    .eq("entity_code", entity);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entity, rows: data || [] });
}
