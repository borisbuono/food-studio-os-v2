import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { matchEntity, matchMovement, type EntityCode } from "@/lib/finance/bank-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/reconciliation/match
//
// Body: { entity_code: "IFL" | "BM" | "BBH", limit?: number }
//    or { movement_id: "<uuid>" }  — one-off, useful for the FAB.
//
// Returns a per-entity summary of how many candidates were upserted, how many
// AI fallbacks were used, and a by-match-type breakdown. Idempotent —
// re-running against the same set of movements just refreshes the same
// candidates rather than duplicating them.

const VALID: EntityCode[] = ["IFL", "BM", "BBH"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    if (body?.movement_id) {
      const sb = supabaseServer();
      const { data } = await sb
        .from("bank_movements")
        .select("id,entity_id,bank_account,movement_date,amount_eur,description,holded_movement_id,reconciled_to,reconciled_to_id,reconciled_status")
        .eq("id", String(body.movement_id))
        .maybeSingle();
      if (!data) return NextResponse.json({ ok: false, error: "movement not found" }, { status: 404 });
      const res = await matchMovement(data as any);
      // Upsert the candidates the caller expects to see back.
      if (res.candidates.length) {
        await sb
          .from("bank_match_candidates")
          .upsert(res.candidates.map((c) => ({
            entity_code: c.entity_code,
            bank_movement_id: c.bank_movement_id,
            match_type: c.match_type,
            match_target_id: c.match_target_id,
            match_target_label: c.match_target_label,
            finder: c.finder,
            confidence: Number(c.confidence.toFixed(3)),
            rationale: c.rationale,
            status: "proposed",
            meta: c.meta,
          })), { onConflict: "bank_movement_id,match_type,match_target_id,finder" });
      }
      return NextResponse.json({ ok: true, movement_id: body.movement_id, result: res });
    }

    const entity = String(body?.entity_code || "").toUpperCase();
    if (!VALID.includes(entity as EntityCode)) {
      return NextResponse.json({ ok: false, error: "entity_code required (IFL|BM|BBH)" }, { status: 400 });
    }
    const limit = Number(body?.limit || 200);
    const summary = await matchEntity(entity as EntityCode, { limit });
    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// GET /api/finance/reconciliation/match?entity=IFL — count of proposed candidates.
export async function GET(req: NextRequest) {
  const entity = (req.nextUrl.searchParams.get("entity") || "").toUpperCase();
  if (!VALID.includes(entity as EntityCode)) {
    return NextResponse.json({ ok: false, error: "entity=? required" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { count } = await sb
    .from("bank_match_candidates")
    .select("id", { count: "exact", head: true })
    .eq("entity_code", entity)
    .eq("status", "proposed");
  return NextResponse.json({ ok: true, entity, proposed: count ?? 0 });
}
