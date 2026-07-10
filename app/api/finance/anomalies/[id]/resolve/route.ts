import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/anomalies/:id/resolve — mark an anomaly resolved.
// The nightly detector will re-open the row if the underlying condition
// is still there (same meta_hash), so "resolve" is really "ack — I know".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  const { error } = await sb.from("finance_anomalies").update({
    resolved_at: new Date().toISOString(),
    resolved_by: uid,
    updated_at: new Date().toISOString(),
  }).eq("id", params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "anomaly_scan",
    action_type: "finance.anomaly.resolve",
    target_table: "finance_anomalies",
    target_id: params.id,
    reversible: false,
  });
  return NextResponse.json({ ok: true });
}
