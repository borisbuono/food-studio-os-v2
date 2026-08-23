import { NextResponse } from "next/server";
import { getMyMembershipContext } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// Push 1 (2026-08-23) — client-shell endpoint.
// Returns the active memberships + resolved primary room for the signed-in
// user. AppChrome uses this to decide whether to render the full sidebar,
// the slim single-role chrome, or the owner shell with a room switcher.
export async function GET() {
  const ctx = await getMyMembershipContext();
  return NextResponse.json(ctx);
}
