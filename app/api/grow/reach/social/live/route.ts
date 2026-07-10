import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/grow/reach/social/live
// Tiny probe the Calendar UI reads to show a "dry-run" vs "buffer live" badge.
// The Buffer scheduler is gated by FS_SOCIAL_LIVE=true; anything else is a
// dry-run recorded in social_posts.buffer_update_id as a `dry-buffer-…` marker.
export async function GET() {
  const live = String(process.env.FS_SOCIAL_LIVE || "").toLowerCase() === "true";
  return NextResponse.json({ ok: true, live });
}
