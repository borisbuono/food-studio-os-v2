import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getAccountingAdapter } from "@/lib/integrations/registry";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { entity } = await req.json();
    if (!entity || !["IFL","BM","BBH"].includes(entity)) return NextResponse.json({ ok: false, error: "entity required" }, { status: 400 });
    const adapter = getAccountingAdapter(entity as EntityCode);
    const purchases = await adapter.listUnapprovedPurchases(entity as EntityCode);
    if (!purchases.length) return NextResponse.json({ ok: true, fetched: 0, inserted: 0, adapter: adapter.name });

    const sb = supabaseServer();
    // Idempotent upsert by holded_doc_id (= external_id from adapter)
    const rows = purchases.map((p) => ({
      entity_id: entity, source: "holded_scan",
      source_ref: p.external_id, holded_doc_id: p.external_id,
      arrived_at: p.date + "T00:00:00Z",
      supplier_name: p.supplier_name,
      amount_eur: p.amount_eur, vat_eur: p.vat_eur,
      match_status: "needs_triage",
      notes: `Sync ${new Date().toISOString().slice(0,10)} from ${adapter.name}`,
    }));
    const { data, error } = await sb.from("invoice_inbox").upsert(rows, { onConflict: "holded_doc_id", ignoreDuplicates: false }).select("id");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, fetched: purchases.length, inserted: data?.length || 0, adapter: adapter.name });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
