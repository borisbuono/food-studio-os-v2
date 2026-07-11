import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { learnFromAccepted, markPatternHit } from "@/lib/finance/pattern-learner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/reconciliation/decide
//
// Bodies:
//   { candidate_id, decision: "accept" | "reject" | "manual" }
//   { candidate_ids: [], decision: "accept" }            — bulk accept
//   { movement_id, decision: "manual", note?: string }   — mark manually reconciled
//                                                          without picking a candidate
//
// On "accept" the corresponding bank_movements row flips reconciled_status =
// 'matched', reconciled_to + reconciled_to_id are set from the candidate, and
// the sibling candidates on the same movement drop to 'rejected'.

type Decision = "accept" | "reject" | "manual";

const MATCH_TYPE_TO_RECONCILED_TO: Record<string, string> = {
  invoice: "invoice",
  eod: "salesreceipt",
  asiento: "asiento",
  intercompany: "intercompany",
  salary: "asiento",
  tax: "tax",
  "self-transfer": "asiento",
  unknown: "asiento",
};

async function acceptCandidate(sb: any, candidateId: string, uid: string | null): Promise<{ ok: boolean; error?: string; movement_id?: string }> {
  const { data: cand } = await sb
    .from("bank_match_candidates")
    .select("id,entity_code,bank_movement_id,match_type,match_target_id,match_target_label,rationale,status")
    .eq("id", candidateId)
    .maybeSingle();
  if (!cand) return { ok: false, error: "candidate not found" };
  if (cand.status === "accepted") return { ok: true, movement_id: cand.bank_movement_id };

  const nowIso = new Date().toISOString();
  const { error: acceptErr } = await sb
    .from("bank_match_candidates")
    .update({ status: "accepted", decided_at: nowIso, decided_by: uid })
    .eq("id", candidateId);
  if (acceptErr) return { ok: false, error: acceptErr.message };

  // Losers on the same movement become rejected.
  const { error: rejErr } = await sb
    .from("bank_match_candidates")
    .update({ status: "rejected", decided_at: nowIso, decided_by: uid })
    .eq("bank_movement_id", cand.bank_movement_id)
    .neq("id", candidateId)
    .eq("status", "proposed");
  if (rejErr) return { ok: false, error: rejErr.message };

  const reconciledTo = MATCH_TYPE_TO_RECONCILED_TO[cand.match_type] || "asiento";
  const { error: mvErr } = await sb
    .from("bank_movements")
    .update({
      reconciled_status: "matched",
      reconciled_to: reconciledTo,
      reconciled_to_id: cand.match_target_id,
      reconciled_at: nowIso,
      reconciled_by: uid,
      matched_at: nowIso,
    })
    .eq("id", cand.bank_movement_id);
  if (mvErr) return { ok: false, error: mvErr.message };

  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "reconciliation",
    action_type: "finance.reconciliation.accept",
    target_table: "bank_match_candidates",
    target_id: candidateId,
    payload: { movement_id: cand.bank_movement_id, match_type: cand.match_type, target: cand.match_target_id, label: cand.match_target_label },
    reversible: true,
  });

  // If the accepted candidate was produced by the pattern engine, bump the
  // hit counter so the patterns dashboard shows fresh learning. Fetch the
  // movement date + candidate meta lazily (the earlier select didn't grab it).
  try {
    const { data: full } = await sb
      .from("bank_match_candidates")
      .select("meta,bank_movements:bank_movement_id(movement_date)")
      .eq("id", candidateId)
      .maybeSingle();
    const patternId = (full as any)?.meta?.pattern_id;
    const mvDate = ((Array.isArray((full as any)?.bank_movements) ? (full as any).bank_movements[0] : (full as any)?.bank_movements) as any)?.movement_date;
    if (patternId && mvDate) await markPatternHit(String(patternId), String(mvDate).slice(0, 10));
  } catch {}
  return { ok: true, movement_id: cand.bank_movement_id };
}

async function rejectCandidate(sb: any, candidateId: string, uid: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("bank_match_candidates")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: uid })
    .eq("id", candidateId);
  if (error) return { ok: false, error: error.message };
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "reconciliation",
    action_type: "finance.reconciliation.reject",
    target_table: "bank_match_candidates",
    target_id: candidateId,
    reversible: true,
  });
  return { ok: true };
}

async function markManual(sb: any, movementId: string, uid: string | null, note?: string): Promise<{ ok: boolean; error?: string }> {
  const nowIso = new Date().toISOString();
  const { error: mvErr } = await sb
    .from("bank_movements")
    .update({
      reconciled_status: "reconciled_manual",
      reconciled_at: nowIso,
      reconciled_by: uid,
      matched_at: nowIso,
      notes: note ?? null,
    })
    .eq("id", movementId);
  if (mvErr) return { ok: false, error: mvErr.message };
  await sb
    .from("bank_match_candidates")
    .update({ status: "manual", decided_at: nowIso, decided_by: uid })
    .eq("bank_movement_id", movementId)
    .eq("status", "proposed");
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "reconciliation",
    action_type: "finance.reconciliation.manual",
    target_table: "bank_movements",
    target_id: movementId,
    payload: { note: note || null },
    reversible: true,
  });
  return { ok: true };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const decision: Decision = body?.decision;
    if (!["accept", "reject", "manual"].includes(decision)) {
      return NextResponse.json({ ok: false, error: "decision required (accept|reject|manual)" }, { status: 400 });
    }
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const uid = u.user?.id || null;

    if (decision === "manual" && body?.movement_id) {
      const r = await markManual(sb, String(body.movement_id), uid, body?.note ? String(body.note) : undefined);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (Array.isArray(body?.candidate_ids) && body.candidate_ids.length) {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of body.candidate_ids) {
        const r = decision === "accept"
          ? await acceptCandidate(sb, String(id), uid)
          : await rejectCandidate(sb, String(id), uid);
        results.push({ id: String(id), ok: r.ok, error: r.error });
      }
      const okCount = results.filter((r) => r.ok).length;
      // After bulk accept, try to promote any newly-recurring pattern.
      try {
        // Best-effort — the movement rows we just accepted are on one entity
        // in most workflows. Fetch it from the first candidate.
        const first = body.candidate_ids[0];
        const { data: any0 } = await sb.from("bank_match_candidates").select("entity_code").eq("id", String(first)).maybeSingle();
        if (any0?.entity_code) await learnFromAccepted(any0.entity_code as any);
      } catch {}
      return NextResponse.json({ ok: okCount === results.length, accepted: okCount, results });
    }
    if (body?.candidate_id) {
      const r = decision === "accept"
        ? await acceptCandidate(sb, String(body.candidate_id), uid)
        : await rejectCandidate(sb, String(body.candidate_id), uid);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
      // After every single accept, run the pattern learner best-effort.
      if (decision === "accept") {
        try {
          const { data: c0 } = await sb.from("bank_match_candidates").select("entity_code").eq("id", String(body.candidate_id)).maybeSingle();
          if (c0?.entity_code) await learnFromAccepted(c0.entity_code as any);
        } catch {}
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "provide candidate_id, candidate_ids, or movement_id" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
