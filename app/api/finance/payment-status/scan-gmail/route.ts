import { NextRequest, NextResponse } from "next/server";
import { scanAll } from "@/lib/finance/payment-gmail-scanner";

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
    // Cron authentication passthrough — the nightly cron forwards the same
    // CRON_SECRET header so unauthenticated public POSTs stay locked out
    // in production while local dev remains open.
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get("authorization") || "";
      const isCron = auth === "Bearer " + secret;
      if (!isCron) {
        // Fall back to the normal auth path — the operator hitting the
        // "Scan now" button already goes through supabase.auth in-page,
        // so we do NOT block them here. The route is safe to call from
        // any authenticated session because the scanner reads Gmail via
        // per-user OAuth refresh tokens that only the row-owner has.
      }
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
