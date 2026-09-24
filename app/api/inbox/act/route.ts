import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { draftItem, type DraftKind } from "@/lib/social/inboxDraft";
import { approveAndSend, callMetaReply } from "@/lib/social/inboxAct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/inbox/act — the one tap.
//
//   { action: "approve", kind, id, text }   tick: write approved_by_boris + call meta-reply
//   { action: "skip",    kind, id }
//   { action: "restore", kind, id }         un-skip
//   { action: "hide",    kind: "comment", id }
//   { action: "redraft", kind, id }
//
// Auth: the signed-in user. Every row write goes through the cookie-bound
// client, so RLS (rls35 managed-entity policies) decides who may approve.
// The send itself is meta-reply, which re-checks approved_by_boris on the
// row — this route cannot make it send anything it would not send anyway.

type Kind = DraftKind;
const TABLE: Record<Kind, string> = { comment: "social_comments", dm: "social_dm_messages" };

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let p: any;
  try { p = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const action = String(p.action || "");
  const kind = String(p.kind || "") as Kind;
  const id = String(p.id || "");
  if (!TABLE[kind] || !id) return NextResponse.json({ ok: false, error: "kind and id required" }, { status: 400 });
  const table = TABLE[kind];

  // RLS-visible? (also proves membership before we touch the service path)
  const { data: row } = await sb.from(table).select("id, status, draft_reply, entity_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });


  if (action === "approve") {
    // Shared with Chef (lib/social/inboxAct) — one approve path, one gate.
    const r = await approveAndSend(sb, kind, id, String(p.text ?? ""), u.user.id);
    if (r.status === "error") return NextResponse.json({ ok: false, error: r.error }, { status: r.http });
    return NextResponse.json({ ok: r.ok, status: r.status, error: r.error, reply_remote_id: r.reply_remote_id }, { status: r.http });
  }

  if (action === "skip" || action === "restore") {
    const status = action === "skip" ? "skipped" : (row.draft_reply ? "drafted" : "new");
    const { error } = await sb.from(table).update({ status }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, status });
  }

  if (action === "hide") {
    if (kind !== "comment") return NextResponse.json({ ok: false, error: "hide is for comments" }, { status: 400 });
    // Prove write access under RLS before the service path hides it.
    const { error } = await sb.from(table).update({ error: null }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    const r = await callMetaReply({ kind, id, action: "hide" });
    const ok = r.http === 200;
    return NextResponse.json({ ok, status: ok ? "hidden" : row.status, error: ok ? null : (r.body?.error || `meta-reply ${r.http}`) }, { status: ok ? 200 : 502 });
  }

  if (action === "redraft") {
    const svc = supabaseService();
    if (!svc) return NextResponse.json({ ok: false, error: "no service key" }, { status: 503 });
    // Put it back to 'new' so the drafter accepts it, keeping the user's edit safe (reply_text untouched).
    const { error } = await sb.from(table).update({ status: "new", flagged: false, flag_reason: null }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    const r = await draftItem(svc, kind, id);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
