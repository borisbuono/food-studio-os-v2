import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { draftItem, sweepNew, type DraftKind } from "@/lib/social/inboxDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/inbox/draft
//
//   { "kind": "comment" | "dm", "id": "<row uuid>" }   draft one item
//   { "sweep": true, "limit": 25 }                      draft everything still 'new'
//
// Called by the Postgres insert trigger (social_inbox_request_draft, via
// pg_net) and by meta-inbox-pull after each run. Auth: x-inbox-secret, the
// Vault-minted social_inbox_secret, checked back through the
// social_inbox_secret_ok() RPC with the service client. Public path in
// middleware for that reason — there is no cookie on these calls.
//
// This only WRITES DRAFTS. Nothing here can send: meta-reply is the only
// path out and it needs approved_by_boris.

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-inbox-secret") || "";
  if (!secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const svc = supabaseService();
  if (!svc) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  const { data: ok } = await svc.rpc("social_inbox_secret_ok", { p_secret: secret });
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body.sweep) {
    const r = await sweepNew(svc, Math.min(Number(body.limit) || 25, 50));
    return NextResponse.json({ ok: true, sweep: r });
  }
  const kind = String(body.kind || "") as DraftKind;
  const id = String(body.id || "");
  if (!["comment", "dm"].includes(kind) || !id) {
    return NextResponse.json({ ok: false, error: "kind (comment|dm) and id required" }, { status: 400 });
  }
  const r = await draftItem(svc, kind, id);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
