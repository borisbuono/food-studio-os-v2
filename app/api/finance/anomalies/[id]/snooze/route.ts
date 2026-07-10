import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/anomalies/:id/snooze — hide until { until: ISO }.
// Body: { until?: string } — defaults to +7 days.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const until = typeof body?.until === "string" && body.until
    ? body.until
    : new Date(Date.now() + 7 * 86_400_000).toISOString();
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  const { error } = await sb.from("finance_anomalies").update({
    snoozed_until: until,
    updated_at: new Date().toISOString(),
  }).eq("id", params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "anomaly_scan",
    action_type: "finance.anomaly.snooze",
    target_table: "finance_anomalies",
    target_id: params.id,
    payload: { until },
    reversible: false,
  });
  return NextResponse.json({ ok: true, until });
}
