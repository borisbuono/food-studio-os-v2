import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { requireManagerOf } from "@/lib/access/requireManager";
import { pullAll } from "@/lib/email/pull";
import { sweepNewThreads } from "@/lib/email/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/email/pull
//
//   header x-inbox-secret (Vault email_inbox_secret) + {via:"cron"}   every mailbox   ← pg_cron every 10 min
//   signed-in manager + { entity: <slug|uuid> }                        that house's mailboxes ("Pull now" button)
//
// Reads Gmail, writes rows. Never sends, never labels. Public path in
// middleware for the secret-carrying call (no cookie on pg_net); the manager
// path still passes requireManagerOf.
export async function POST(req: NextRequest) {
  const svc = supabaseService();
  if (!svc) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const secret = req.headers.get("x-inbox-secret") || "";
  if (secret) {
    const { data: ok } = await svc.rpc("email_inbox_secret_ok", { p_secret: secret });
    if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const results = await pullAll(svc, String(body.via || "cron"));
    // E2 sweep: anything still 'new' after the pull gets classified.
    const classified = await sweepNewThreads(svc).catch((e: any) => ({ error: String(e?.message || e) }));
    return NextResponse.json({ ok: true, results, classified });
  }

  const sb = supabaseServer();
  const gate = await requireManagerOf(sb, body.entity);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const results = await pullAll(svc, "manual", { entityId: gate.entity_id });
  const classified = await sweepNewThreads(svc, { entityId: gate.entity_id }).catch((e: any) => ({ error: String(e?.message || e) }));
  return NextResponse.json({ ok: true, results, classified });
}
