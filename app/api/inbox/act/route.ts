import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { draftItem, type DraftKind } from "@/lib/social/inboxDraft";

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

async function callMetaReply(payload: Record<string, unknown>) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/meta-reply`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  return { http: r.status, body };
}

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

  const now = new Date().toISOString();

  if (action === "approve") {
    const text = String(p.text ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "empty reply" }, { status: 422 });
    if (row.status === "replied") return NextResponse.json({ ok: false, error: "already replied" }, { status: 409 });
    const { error } = await sb.from(table).update({
      reply_text: text, approved_by_boris: true, approved_at: now, approved_by_user: u.user.id, status: "approved", error: null,
    }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: `approve: ${error.message}` }, { status: 403 });
    const r = await callMetaReply({ kind, id });
    const ok = r.http === 200 && r.body?.ok !== false;
    return NextResponse.json({
      ok, status: ok ? "replied" : "failed",
      error: ok ? null : (r.body?.detail || r.body?.error || `meta-reply ${r.http}`),
      reply_remote_id: r.body?.reply_remote_id ?? null,
    }, { status: ok ? 200 : 502 });
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
