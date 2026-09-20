import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/approve  { post_id, approved: boolean }
//
// Boris's approval gate on a social_posts row. The rule says signing feels
// like ticking, not configuring — one click flips a boolean, and only the
// meta-publish edge function reads it (403 not_approved otherwise). Auth-gated
// to owner/manager on the venue that owns the post.
//
// Response: { ok, approved_by_boris, approved_by_user, approved_at }
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }

  let body: { post_id?: string; approved?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const post_id = String(body?.post_id || "").trim();
  const approved = Boolean(body?.approved);
  if (!post_id) {
    return NextResponse.json({ ok: false, error: "post_id required" }, { status: 400 });
  }

  // Load the row so we can gate on caller role for THAT venue, and refuse a
  // late tick on something already out the door.
  const { data: row, error: rErr } = await sb
    .from("social_posts")
    .select("id, entity_code, status")
    .eq("id", post_id)
    .single();
  if (rErr || !row) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (row.status === "published") {
    return NextResponse.json({ ok: false, error: "already_published" }, { status: 409 });
  }

  // entity_code on social_posts is the historical string (BM/IFL/BBH) while
  // memberships lives on entities.id — resolve via the same RPC meta-publish
  // uses so both surfaces read the same aliasing.
  const { data: entityId, error: reErr } = await sb.rpc("resolve_entity", { p_code: row.entity_code });
  if (reErr || !entityId) {
    return NextResponse.json({ ok: false, error: "entity_unresolved" }, { status: 500 });
  }

  const ctx = await getMyMembershipContext();
  const OWNER_ROLES = new Set(["owner", "manager", "gm", "director", "admin", "operator"]);
  const canApprove = ctx.memberships.some(
    (m) => m.entity_id === entityId && OWNER_ROLES.has((m.role || "").toLowerCase()),
  );
  if (!canApprove) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await sb
    .from("social_posts")
    .update({
      approved_by_boris: approved,
      approved_by_user: approved ? u.user.id : null,
      approved_at: approved ? now : null,
    })
    .eq("id", post_id)
    .select("id, approved_by_boris, approved_by_user, approved_at")
    .single();
  if (uErr || !updated) {
    return NextResponse.json({ ok: false, error: uErr?.message || "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...updated });
}
