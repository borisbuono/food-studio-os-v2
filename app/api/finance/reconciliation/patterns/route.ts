import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { learnFromAccepted } from "@/lib/finance/pattern-learner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntityCode = "IFL" | "BM" | "BBH";
const VALID: EntityCode[] = ["IFL", "BM", "BBH"];

// GET /api/finance/reconciliation/patterns?entity=IFL — list active patterns.
export async function GET(req: NextRequest) {
  const entity = (req.nextUrl.searchParams.get("entity") || "").toUpperCase();
  if (!VALID.includes(entity as EntityCode)) return NextResponse.json({ ok: false, error: "entity=? required" }, { status: 400 });
  const sb = supabaseServer();
  const { data } = await sb
    .from("recurring_bank_patterns")
    .select("id,entity_code,pattern_type,reference_regex,expected_amount_range,expected_frequency,match_type,label,learn_confidence,first_seen,last_seen,times_matched,disabled_at,bank_account,created_at")
    .eq("entity_code", entity)
    .order("times_matched", { ascending: false })
    .limit(200);
  return NextResponse.json({ ok: true, entity, rows: data || [] });
}

// POST /api/finance/reconciliation/patterns
//   { action: "add",     pattern: { entity_code, pattern_type, reference_regex, ... } }
//   { action: "disable", id }
//   { action: "enable",  id }
//   { action: "delete",  id }
//   { action: "learn",   entity_code }   -- force a learning pass
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const uid = u.user?.id || null;

    if (body?.action === "learn") {
      const entity = String(body?.entity_code || "").toUpperCase();
      if (!VALID.includes(entity as EntityCode)) return NextResponse.json({ ok: false, error: "entity_code required" }, { status: 400 });
      const r = await learnFromAccepted(entity as EntityCode);
      return NextResponse.json({ ok: true, learned: r.learned });
    }

    if (body?.action === "add") {
      const p = body.pattern || {};
      if (!VALID.includes(p.entity_code)) return NextResponse.json({ ok: false, error: "entity_code required" }, { status: 400 });
      if (!p.reference_regex) return NextResponse.json({ ok: false, error: "reference_regex required" }, { status: 400 });
      try { new RegExp(p.reference_regex); } catch (e: any) { return NextResponse.json({ ok: false, error: "invalid regex: " + e?.message }, { status: 400 }); }
      const row = {
        entity_code: p.entity_code,
        pattern_type: p.pattern_type || "manual",
        reference_regex: p.reference_regex,
        expected_amount_range: p.expected_amount_range || {},
        expected_frequency: p.expected_frequency || "monthly",
        bank_account: p.bank_account || null,
        match_type: p.match_type || "unknown",
        label: p.label || "Manual pattern",
        learn_confidence: p.learn_confidence != null ? Number(p.learn_confidence) : 0.9,
        created_by: uid,
      };
      const { data, error } = await sb.from("recurring_bank_patterns").upsert(row, { onConflict: "entity_code,pattern_type,reference_regex" }).select("id").maybeSingle();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id: data?.id });
    }

    if (body?.action === "disable") {
      if (!body?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const { error } = await sb.from("recurring_bank_patterns").update({ disabled_at: new Date().toISOString(), disabled_by: uid }).eq("id", body.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "enable") {
      if (!body?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const { error } = await sb.from("recurring_bank_patterns").update({ disabled_at: null, disabled_by: null }).eq("id", body.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "delete") {
      if (!body?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const { error } = await sb.from("recurring_bank_patterns").delete().eq("id", body.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
