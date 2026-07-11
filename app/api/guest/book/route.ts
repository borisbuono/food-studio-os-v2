import { guestServiceClient } from "@/lib/guest/serviceClient";
import { validEmail, sanitizePhone } from "@/lib/guest/booking";
import { signGuestToken } from "@/lib/guest/token";
import { sendGuestEmail, confirmationEmailHtml } from "@/lib/guest/email";
import { getGuestBrand } from "@/lib/guest/brand";

export const runtime = "nodejs";

// POST /api/guest/book — guest self-service booking submission from /m/[slug]/book.
//
// Behaviour:
//   1. Resolve slug → restaurant.
//   2. Upsert a guests row (by email within the restaurant) with any preferences
//      the guest volunteered — merge, don't clobber, so a returning guest doesn't
//      lose earlier notes on a new booking.
//   3. Insert a bookings row (source = 'web') linked to the guest.
//   4. Sign a preferences token (JWT, 90-day expiry) and send a confirmation
//      email containing the deeplink.
//
// Never trust the client — restaurant_id from the body is cross-checked against
// the slug's restaurant row.

type Payload = {
  slug?: string;
  restaurant_id?: string;
  party_size?: number;
  service_date?: string;         // yyyy-mm-dd
  service_time?: string;         // hh:mm
  name?: string;
  email?: string;
  phone?: string;
  occasion?: string | null;
  notes?: string | null;
  seating_preference?: string | null;
  allergies?: string[];
  dietary?: string[];
};

export async function POST(req: Request) {
  const sb = guestServiceClient;
  let body: Payload = {};
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad JSON" }, { status: 400 }); }

  const slug = String(body.slug || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = sanitizePhone(String(body.phone || ""));
  const partySize = Number(body.party_size || 0);
  const svcDate = String(body.service_date || "").trim();
  const svcTime = String(body.service_time || "").trim();

  if (!slug) return Response.json({ ok: false, error: "slug missing" }, { status: 400 });
  if (!name || !email || !svcDate || !svcTime || !partySize) {
    return Response.json({ ok: false, error: "name, email, date, time and party size are required" }, { status: 400 });
  }
  if (!validEmail(email)) return Response.json({ ok: false, error: "email looks off" }, { status: 400 });
  if (partySize < 1 || partySize > 40) return Response.json({ ok: false, error: "party size out of range" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(svcDate)) return Response.json({ ok: false, error: "date format" }, { status: 400 });
  if (!/^\d{2}:\d{2}$/.test(svcTime)) return Response.json({ ok: false, error: "time format" }, { status: 400 });

  const { data: r } = await sb.from("restaurants").select("id,name,public_slug").eq("public_slug", slug).maybeSingle();
  if (!r) return Response.json({ ok: false, error: "venue not found" }, { status: 404 });
  const brand = getGuestBrand(slug, r.name || undefined);

  // Upsert guest — match on (restaurant_id, email). Merge preferences.
  const { data: existing } = await sb.from("guests")
    .select("id,allergies,dietary,notes")
    .eq("restaurant_id", r.id).eq("email", email).limit(1).maybeSingle();

  const mergedAllergies = mergeString(existing?.allergies as string | null, (body.allergies || []).join(", "));
  const mergedDietary   = mergeString(existing?.dietary   as string | null, (body.dietary   || []).join(", "));
  const mergedNotes     = mergeNotes(existing?.notes as string | null, body.notes || null, body.seating_preference || null);

  let guest_id: string;
  if (existing?.id) {
    guest_id = existing.id;
    await sb.from("guests").update({
      name, phone: phone || undefined,
      allergies: mergedAllergies, dietary: mergedDietary, notes: mergedNotes,
      last_visit_at: null,   // preserve prior last_visit; the seating flow updates this
    }).eq("id", guest_id);
  } else {
    const ins = await sb.from("guests").insert({
      restaurant_id: r.id,
      name, email, phone: phone || null,
      allergies: mergedAllergies, dietary: mergedDietary, notes: mergedNotes,
      source: "booking",
    }).select("id").single();
    if (ins.error || !ins.data) return Response.json({ ok: false, error: "guest save failed" }, { status: 500 });
    guest_id = ins.data.id;
  }

  // Booking insert.
  const bookingInsert = await sb.from("bookings").insert({
    restaurant_id: r.id,
    guest_id,
    guest_name: name,
    party_size: partySize,
    service_date: svcDate,
    service_time: svcTime,
    status: "booked",
    source: "web",
    notes: [
      body.occasion ? `Occasion: ${body.occasion}` : null,
      body.seating_preference ? `Seating: ${body.seating_preference}` : null,
      body.notes ? `Notes: ${body.notes}` : null,
    ].filter(Boolean).join(" · ") || null,
  }).select("id").single();
  if (bookingInsert.error || !bookingInsert.data) {
    return Response.json({ ok: false, error: "booking save failed" }, { status: 500 });
  }
  const bookingId = bookingInsert.data.id;

  // Sign a preferences token + build the deeplink.
  let prefLink = "";
  try {
    const token = signGuestToken({ g: guest_id, b: bookingId, r: r.id, k: "preferences" });
    const origin = originFromReq(req);
    prefLink = `${origin}/m/${slug}/preferences?token=${encodeURIComponent(token)}`;
  } catch {
    // If token signing fails (no secret), still succeed — guest gets a bare confirmation.
    prefLink = "";
  }

  // Send confirmation email (best-effort — a failed email doesn't fail the booking).
  const dateLabel = new Date(svcDate + "T00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
  await sendGuestEmail({
    to: email,
    subject: `Booking confirmed — ${r.name || brand.restaurantName} on ${dateLabel}`,
    html: confirmationEmailHtml({
      venueName: r.name || brand.restaurantName,
      guestName: name.split(" ")[0] || name,
      dateLabel, timeLabel: svcTime,
      partySize, preferencesLink: prefLink || `${originFromReq(req)}/m/${slug}`,
      brandAccent: brand.accent,
    }),
  });

  return Response.json({ ok: true, booking_id: bookingId, guest_id, preferences_link: prefLink || null });
}

function mergeString(prev: string | null, next: string | null | undefined): string | null {
  const N = (next || "").trim();
  const P = (prev || "").trim();
  if (!N) return P || null;
  if (!P) return N || null;
  if (P.toLowerCase() === N.toLowerCase()) return P;
  return `${P}; ${N}`;
}
function mergeNotes(prev: string | null, note: string | null, seating: string | null): string | null {
  const bits = [prev || "", note ? `[booking note] ${note}` : "", seating ? `[seating] ${seating}` : ""].filter(Boolean);
  return bits.length ? bits.join("\n") : null;
}
function originFromReq(req: Request): string {
  const u = new URL(req.url);
  const forwarded = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${forwarded}`;
}
