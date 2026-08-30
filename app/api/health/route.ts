import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unauth-accessible uptime probe. Middleware allow-lists this path so external
// monitors and load balancers can hit it without a session.
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "food-studio-os",
    ts: new Date().toISOString(),
  });
}
