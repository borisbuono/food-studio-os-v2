import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { observe, readObservations } from "@/lib/observations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The observation log over HTTP (Foundation §3 store 2).
//
// POST /api/observations  {entity_code|entity_id, body, source, domain?, subject?}
//   → {ok, id}. Session-authenticated; RLS admits entity members only. The
//   same call the SQL RPC observe() offers to lab agents.
//
// GET  /api/observations?entity=&domain=&subject=&since=&limit=
//   → {ok, rows}. For an agent reading its own domain or a counterparty
//   before dealing with it. NOT for the shell, the brief or the idle screen:
//   the log is never read at session open, and there is no UI list page.

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const r = await observe(sb, {
    entity_code: b?.entity_code ?? b?.entity ?? null, entity_id: b?.entity_id ?? null,
    body: b?.body, source: b?.source, domain: b?.domain ?? null, subject: b?.subject ?? null,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const r = await readObservations(sb, {
    entity: p.get("entity") || p.get("entity_code"), domain: p.get("domain"), subject: p.get("subject"),
    since: p.get("since"), limit: Number(p.get("limit") || 200),
  });
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, rows: r.rows, count: r.rows.length });
}
