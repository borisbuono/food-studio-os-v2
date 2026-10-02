import { NextRequest, NextResponse } from "next/server";
import { scanAll } from "@/lib/finance/payment-gmail-scanner";
import { cronAuthorized } from "@/lib/cron/heartbeat";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAnyMembership } from "@/lib/access/requireManager";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/payment-status/scan-gmail
//
// Sweeps every connected Gmail assistant_channel for billing-failure emails
// and updates platform_billing_status accordingly. Read-only against Gmail
// — nothing is labelled, archived, or replied to. Every state change is
// logged to assistant_actions (action_kind='payment_scan_gmail').
//
// Body (optional):
//   { since?: ISO string, nightly?: boolean }
//
// The nightly cron at /api/cron/finance/nightly-scan calls this route so it
// runs once a day without any operator interaction. The Payments page also
// exposes a "Scan now" button that calls it on demand.
export async function POST(req: NextRequest) {
  try {
    // S4: cron lane = Bearer CRON_SECRET (fails closed); otherwise a signed-in
    // member. The scanner reads Gmail with per-user refresh tokens but writes
    // platform_billing_status through supabaseJob(), so a stranger with a
    // login must not reach it.
    const cron = await cronAuthorized(req);
    if (!cron.ok) {
      const gate = await requireAnyMembership(supabaseServer());
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const body = await req.json().catch(() => ({} as any));
    const since = typeof body?.since === "string" && body.since ? new Date(body.since) : undefined;

    const summary = await scanAll(since ? { since } : undefined);
    return NextResponse.json({
      ok: true,
      channels_seen: summary.channels_seen,
      hits_total:    summary.hits_total,
      updated_total: summary.updated_total,
      per_channel:   summary.channels.map((c) => ({
        entity: c.entity_code, account: c.account, threads_seen: c.threads_seen,
        hits: c.hits, updated: c.updated, error: c.error || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// GET — quick counts for the Payments page to render the "last scan" hint.
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST this endpoint to run a Gmail sweep across every connected assistant_channels row of type gmail.",
  });
}
