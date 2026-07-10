import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Placeholder — the real Gmail scanner lands in Finance intelligence #3.
// Kept as a 200-OK stub so the nightly cron route can call it unconditionally
// without a 404 in the interim.
export async function POST(_req: NextRequest) {
  return NextResponse.json({ ok: true, scanned: 0, updates: 0, note: "stub — see Finance intelligence #3" });
}
