import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { verifyFrestoSignature, resolveEntityFromSlug, extractBusinessDate } from "@/lib/integrations/pos/fresto-webhook";
import { persistPullToPos, pullZReport } from "@/lib/integrations/pos/fresto";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

// Fresto webhook receiver — `closing-report`.
//
// Fresto POSTs a lightweight envelope (id + business date). We fetch the full Z Report
// via the API, land the immutable eod_pos snapshot, then trigger the accounting draft
// (which applies the house Cash-line deduction rule per restaurants.deduct_pos_cash_from_food).
//
// URL configured in Fresto: https://foodstudio.ai/api/integrations/fresto/webhook/closing-report-submitted?entity=IFL

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-fresto-signature");
  const url = new URL(req.url);
  const entity = resolveEntityFromSlug(url.searchParams.get("entity"));
  const verified = verifyFrestoSignature(raw, sig, entity || undefined);

  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { payload = { _parse_error: true }; }

  const sb = supabaseServer();
  const safeHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() === "authorization" || k.toLowerCase() === "cookie") return;
    safeHeaders[k] = v;
  });

  const logIns = await sb.from("fresto_webhook_events").insert({
    entity_code: entity,
    action: "closing-report",
    fresto_id: payload?.id || null,
    business_date: extractBusinessDate(payload),
    raw_headers: safeHeaders,
    raw_body: payload,
    signature_header: sig,
    signature_verified: verified,
  }).select("id").single();
  const eventId = logIns.data?.id;

  if (!verified) return NextResponse.json({ ok: false, error: "signature verification failed" }, { status: 401 });
  if (!entity) return NextResponse.json({ ok: false, error: "missing ?entity=IFL|BM|BBH" }, { status: 400 });

  const restaurant_id = RESTAURANT_ID_BY_ENTITY[entity];
  if (!restaurant_id) {
    if (eventId) await markProcessed(sb, eventId, false, "no restaurant mapping");
    return NextResponse.json({ ok: false, error: `no restaurant_id mapped for ${entity}` }, { status: 400 });
  }

  const business_date = extractBusinessDate(payload);
  if (!business_date) {
    if (eventId) await markProcessed(sb, eventId, false, "no business date in payload");
    return NextResponse.json({ ok: false, error: "payload missing business date / toDate" }, { status: 400 });
  }

  try {
    // If the payload was minimal, fetch the authoritative Z Report via the API before landing eod_pos.
    // We use pullZReport for side-effect-free readback; persistPullToPos does its own fetch as well
    // (orderlines + zreport combined). The double fetch is intentional — orderlines carry the product-
    // group split, zreport carries the cash/card truth.
    void await pullZReport(entity as EntityCode, business_date); // primes the token cache + surfaces auth errors early

    const res = await persistPullToPos({
      entity: entity as EntityCode,
      restaurant_id,
      date: business_date,
      imported_by: null,
    });

    let eod_accounting_id: string | null = null;
    if (res?.id) {
      // Kick the accounting draft. This applies the house Cash-line-deduction rule.
      const origin = url.origin;
      try {
        const r = await fetch(`${origin}/api/finance/eod/create-accounting-from-pos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eod_pos_id: res.id }),
        });
        const j = await r.json().catch(() => ({}));
        eod_accounting_id = j?.id || null;
      } catch {
        // Non-fatal — the accounting draft can be created later from the sync surface.
      }
    }

    // Audit trail
    await sb.from("assistant_actions").insert({
      user_id: null,
      action_kind: "fresto_webhook",
      action_type: "fresto.webhook.closing_report",
      entity_code: entity,
      target_table: "eod_pos",
      target_id: res?.id || null,
      payload: {
        business_date,
        fresto_z_report_id: payload?.id || null,
        eod_pos_existed: !!res?.existed,
        eod_accounting_id,
        event_id: eventId,
      },
      reversible: false,
    });

    if (eventId) {
      await sb.from("fresto_webhook_events").update({
        processed_at: new Date().toISOString(),
        processed_ok: true,
        downstream_ref: { eod_pos_id: res?.id || null, eod_accounting_id, existed: res?.existed || false },
      }).eq("id", eventId);
    }
    return NextResponse.json({ ok: true, eod_pos_id: res?.id || null, eod_accounting_id, existed: res?.existed || false });
  } catch (e: any) {
    if (eventId) await markProcessed(sb, eventId, false, e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

async function markProcessed(sb: any, eventId: string, ok: boolean, err?: string | null) {
  await sb.from("fresto_webhook_events").update({
    processed_at: new Date().toISOString(),
    processed_ok: ok,
    processed_error: err || null,
  }).eq("id", eventId);
}

const RESTAURANT_ID_BY_ENTITY: Record<string, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
};
