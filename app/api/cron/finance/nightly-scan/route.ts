import { cronAuthorized } from "@/lib/cron/heartbeat";
import { NextRequest, NextResponse } from "next/server";
import { supabaseJob, hasServiceRole } from "@/lib/supabaseJob";
import { detectAll, type EntityCode } from "@/lib/finance/anomaly-detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nightly finance sweep — Vercel cron target.
//
// Runs the anomaly detector across all 3 entities. From Commit #3 the same
// route will additionally sweep Gmail for billing-failure emails and refresh
// platform_billing_status. Kept as a single endpoint so we only pay one cron
// invocation per night; the sub-tasks are additive.
//
// Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`. In dev,
// we skip the check so `curl` works — same convention as other routes.
export async function GET(req: NextRequest) {
  // P0-6 (audit 2026-09-26): fail closed — Bearer CRON_SECRET only.
  const cron = await cronAuthorized(req);
  if (!cron.ok) return NextResponse.json({ ok: false, error: "unauthorized", who: cron.who }, { status: 401 });
  const secret = process.env.CRON_SECRET;

  const entities: EntityCode[] = ["IFL", "BM", "BBH"];
  const anomaly = await Promise.all(entities.map((e) => detectAll(e, { user_id: null }).catch((err) => ({ error: String(err?.message || err), upserted: 0, by_kind: {} as any, candidates: [] }))));

  // Payment scan hook — the real scanner ships in Commit #3, but wiring the
  // call here now means the cron entry is one-and-done. The route is a no-op
  // if Gmail channels aren't connected.
  let payment_scan_ok = false;
  let payment_scan_error: string | null = null;
  try {
    const origin = new URL(req.url).origin;
    const res = await fetch(origin + "/api/finance/payment-status/scan-gmail", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: "Bearer " + secret } : {}) },
      body: JSON.stringify({ nightly: true }),
    });
    payment_scan_ok = res.ok;
    if (!res.ok) payment_scan_error = "http " + res.status;
  } catch (e: any) {
    payment_scan_error = e?.message || String(e);
  }

  // Audit
  const sb = supabaseJob();
  await sb.from("assistant_actions").insert({
    user_id: null,
    action_kind: "anomaly_scan",
    action_type: "finance.nightly.sweep",
    entity_code: null,
    payload: {
      anomaly: entities.map((e, i) => ({ entity: e, upserted: (anomaly[i] as any).upserted, by_kind: (anomaly[i] as any).by_kind })),
      payment_scan_ok,
      payment_scan_error,
    },
    reversible: false,
  });

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    anomaly: entities.map((e, i) => ({ entity: e, upserted: (anomaly[i] as any).upserted, by_kind: (anomaly[i] as any).by_kind })),
    payment_scan_ok,
    payment_scan_error,
  });
}
