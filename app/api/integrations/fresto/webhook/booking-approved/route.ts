import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { verifyFrestoSignature, resolveEntityFromSlug, extractBusinessDate } from "@/lib/integrations/pos/fresto-webhook";

export const runtime = "nodejs";

// Fresto webhook receiver — `booking.approved`.
//
// Fresto POSTs the raw booking envelope; we log every request (verified or not) to
// fresto_webhook_events, upsert to `bookings`, and try to match a guest by email/phone
// so the CRM tile stays fresh.
//
// URL configured in Fresto: https://foodstudio.ai/api/integrations/fresto/webhook/booking-approved?entity=IFL
// (entity query param is how we resolve which venue the webhook belongs to; Fresto's
// payload does not carry an OS entity code.)
//
// Every downstream mutation is logged to assistant_actions for audit.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-fresto-signature");
  const url = new URL(req.url);
  const entity = resolveEntityFromSlug(url.searchParams.get("entity"));
  const verified = verifyFrestoSignature(raw, sig, entity || undefined);

  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { payload = { _parse_error: true }; }

  const sb = supabaseServer();

  // Headers we care about — sanitise sensitive values.
  const safeHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() === "authorization" || k.toLowerCase() === "cookie") return;
    safeHeaders[k] = v;
  });

  // Log first — even unverified requests leave a trail so we can debug misconfig.
  const logIns = await sb.from("fresto_webhook_events").insert({
    entity_code: entity,
    action: "booking.approved",
    fresto_id: payload?.id || payload?.bookingID || null,
    business_date: extractBusinessDate(payload),
    raw_headers: safeHeaders,
    raw_body: payload,
    signature_header: sig,
    signature_verified: verified,
  }).select("id").single();
  const eventId = logIns.data?.id;

  if (!verified) {
    return NextResponse.json({ ok: false, error: "signature verification failed" }, { status: 401 });
  }
  if (!entity) {
    return NextResponse.json({ ok: false, error: "missing ?entity=IFL|BM|BBH" }, { status: 400 });
  }

  // Resolve restaurant_id for the entity from the setup metadata.
  const restaurant_id = RESTAURANT_ID_BY_ENTITY[entity];
  if (!restaurant_id) {
    if (eventId) await markProcessed(sb, eventId, false, "no restaurant mapping");
    return NextResponse.json({ ok: false, error: `no restaurant_id mapped for ${entity}` }, { status: 400 });
  }

  try {
    const external_id = String(payload?.id || payload?.bookingID || "").trim();
    const service_date = extractBusinessDate(payload) || new Date().toISOString().slice(0, 10);
    const service_time = extractTime(payload?.date);
    const party_size = Number(payload?.guests || payload?.partySize || 2);
    const guest_name = String(payload?.name || payload?.customer?.name || "").slice(0, 200);
    const email = (payload?.email || payload?.customer?.email || "") as string;
    const phone = (payload?.phone || payload?.customer?.phone || "") as string;

    // Upsert booking — soft-match by (restaurant_id, external_id/fresto id, service_date).
    let bookingId: string | null = null;
    const existing = await sb.from("bookings")
      .select("id")
      .eq("restaurant_id", restaurant_id)
      .eq("service_date", service_date)
      .eq("guest_name", guest_name)
      .maybeSingle();
    if (existing.data?.id) {
      bookingId = existing.data.id;
      await sb.from("bookings").update({
        party_size,
        service_time,
        source: "fresto",
        status: "booked",
      }).eq("id", bookingId);
    } else {
      const ins = await sb.from("bookings").insert({
        restaurant_id,
        guest_name,
        party_size,
        service_date,
        service_time,
        source: "fresto",
        status: "booked",
        notes: payload?.notes || null,
      }).select("id").single();
      if (!ins.error) bookingId = ins.data?.id || null;
    }

    // Best-effort guest match — the guests table lives in the CRM half. Match by
    // email first, then phone; only update if we found a single row.
    let guestId: string | null = null;
    if (email) {
      const g = await sb.from("guests").select("id").eq("restaurant_id", restaurant_id).eq("email", email).maybeSingle();
      if (g.data?.id) guestId = g.data.id;
    }
    if (!guestId && phone) {
      const g = await sb.from("guests").select("id").eq("restaurant_id", restaurant_id).eq("phone", phone).maybeSingle();
      if (g.data?.id) guestId = g.data.id;
    }
    if (!guestId && (email || phone)) {
      // Create a lightweight guest so the CRM has a row to build on.
      const g = await sb.from("guests").insert({
        restaurant_id,
        name: guest_name || (email || phone || "Guest"),
        email: email || null,
        phone: phone || null,
        source: "booking",
      }).select("id").single();
      if (!g.error) guestId = g.data?.id || null;
    }
    if (bookingId && guestId) {
      await sb.from("bookings").update({ guest_id: guestId }).eq("id", bookingId);
    }

    // Audit + downstream ref
    await sb.from("assistant_actions").insert({
      user_id: null,
      action_kind: "fresto_webhook",
      action_type: "fresto.webhook.booking_approved",
      entity_code: entity,
      target_table: "bookings",
      target_id: bookingId,
      payload: { external_id, service_date, service_time, party_size, guest_id: guestId, event_id: eventId },
      reversible: false,
    });
    if (eventId) {
      await sb.from("fresto_webhook_events").update({
        processed_at: new Date().toISOString(),
        processed_ok: true,
        downstream_ref: { booking_id: bookingId, guest_id: guestId },
      }).eq("id", eventId);
    }
    return NextResponse.json({ ok: true, booking_id: bookingId, guest_id: guestId });
  } catch (e: any) {
    if (eventId) await markProcessed(sb, eventId, false, e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

function extractTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = String(iso).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

async function markProcessed(sb: any, eventId: string, ok: boolean, err?: string | null) {
  await sb.from("fresto_webhook_events").update({
    processed_at: new Date().toISOString(),
    processed_ok: ok,
    processed_error: err || null,
  }).eq("id", eventId);
}

// Kept in sync with app/administrate/finance/setup/[entity]/page.tsx.
// TODO(cross-cut): promote to a shared entity registry so this map does not drift.
const RESTAURANT_ID_BY_ENTITY: Record<string, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  // BBH has no restaurant today.
};
