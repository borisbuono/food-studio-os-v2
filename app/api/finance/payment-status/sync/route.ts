import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/finance/payment-status/sync — refreshes platform_billing_status.
//
// Today this is a MANUAL update path. The eventual roadmap is a Gmail-based
// billing-failure detector (grep patterns: "we couldn't charge", "payment
// declined", "billing failed") but that requires Gmail OAuth per mailbox
// (boris@ibzfoodstudio.com, admin@bistro-mondo.com, admin@ibzfoodstudio.com,
// borisbuono@gmail.com — see invoice_routing_boris_universe). Deferred as a
// follow-up; ship the seed data + manual updates now.
//
// Body:
//   { entity_code: "IFL"|"BM"|"BBH", platform: "holded"|..., patch: {...} }
// Or:
//   { rows: [{entity_code, platform, patch}, ...] }  for batch updates.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const rows: Array<{ entity_code: string; platform: string; patch: Record<string, any> }> =
      Array.isArray(body?.rows) ? body.rows
      : (body?.entity_code && body?.platform)
        ? [{ entity_code: body.entity_code, platform: body.platform, patch: body.patch || {} }]
        : [];
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "provide entity_code+platform+patch or rows[]" }, { status: 400 });
    }

    const sb = supabaseServer();
    let updated = 0;
    for (const r of rows) {
      if (!["IFL","BM","BBH"].includes(r.entity_code)) continue;
      const patch: Record<string, any> = { ...r.patch, updated_at: new Date().toISOString() };
      // Never let the client rewrite id / entity / platform via patch
      delete patch.id;
      delete patch.entity_code;
      delete patch.platform;
      const { error } = await sb.from("platform_billing_status")
        .update(patch)
        .eq("entity_code", r.entity_code)
        .eq("platform", r.platform);
      if (!error) updated += 1;
    }
    return NextResponse.json({ ok: true, updated, source: "manual" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

// GET /api/finance/payment-status/sync — quick read for the FAB / mini-widgets.
// Returns rows sorted by severity so the caller doesn't need to.
export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from("platform_billing_status")
    .select("entity_code,platform,state,card_last4,last_failure_at,failure_count_30d,billing_url,notes,updated_at");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const rank: Record<string, number> = { disabled: 0, failing: 1, at_risk: 2, missing_card: 3, healthy: 4 };
  const sorted = (data || []).slice().sort((a: any, b: any) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9));
  return NextResponse.json({ ok: true, rows: sorted });
}
