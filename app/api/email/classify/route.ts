import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { classifyThread, sweepNewThreads } from "@/lib/email/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/email/classify
//
//   { "id": "<email_threads uuid>" }        classify + route one thread   ← Postgres trigger via pg_net
//   { "sweep": true, "limit": 20 }           everything still 'new'        ← /api/email/pull after each run
//
// Auth: x-inbox-secret = Vault email_inbox_secret, checked back through
// email_inbox_secret_ok() with the service client. Public path in middleware
// (pg_net carries no cookie). Sorts, labels, captures, registers — never sends.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-inbox-secret") || "";
  if (!secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const svc = supabaseService();
  if (!svc) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  const { data: ok } = await svc.rpc("email_inbox_secret_ok", { p_secret: secret });
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.sweep) {
    const r = await sweepNewThreads(svc, { limit: Math.min(Number(body.limit) || 20, 40) });
    return NextResponse.json({ ok: true, sweep: r });
  }
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const r = await classifyThread(svc, id);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
