import { guestServiceClient } from "@/lib/guest/serviceClient";
import { verifyGuestToken } from "@/lib/guest/token";

export const runtime = "nodejs";

// POST /api/guest/preferences — signed-token gated preferences update.
// Payload:
//   { slug, token, allergens[], dietary[], preferred_table_label, birthday,
//     long_term_notes, visit_needs }
//
// Writes:
//   1. guests row: allergies/dietary (comma-joined chip vocab), birthday, notes
//   2. When the token carries a booking id, upserts a guest_visits DRAFT row
//      (visit_date pre-set to the booking day) with visit_needs in the notes —
//      the /execute/pass flow will surface this as "guest needs" for FOH.
export async function POST(req: Request) {
  const sb = guestServiceClient;
  let body: any = {};
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad JSON" }, { status: 400 }); }

  const slug = String(body.slug || "").trim();
  const token = String(body.token || "").trim();
  if (!slug || !token) return Response.json({ ok: false, error: "slug + token required" }, { status: 400 });

  const payload = verifyGuestToken(token);
  if (!payload || payload.k !== "preferences") {
    return Response.json({ ok: false, error: "invalid or expired token" }, { status: 401 });
  }

  const { data: r } = await sb.from("restaurants").select("id").eq("public_slug", slug).maybeSingle();
  if (!r) return Response.json({ ok: false, error: "venue not found" }, { status: 404 });

  const allergens = Array.isArray(body.allergens) ? (body.allergens as string[]).slice(0, 20) : [];
  const dietary = Array.isArray(body.dietary) ? (body.dietary as string[]).slice(0, 10) : [];
  const preferredTable = body.preferred_table_label ? String(body.preferred_table_label).slice(0, 60) : null;
  const birthday = body.birthday && /^\d{4}-\d{2}-\d{2}$/.test(String(body.birthday)) ? String(body.birthday) : null;
  const longTermNotes = body.long_term_notes ? String(body.long_term_notes).slice(0, 2000) : null;
  const visitNeeds = body.visit_needs ? String(body.visit_needs).slice(0, 2000) : null;

  const notesMerged = [
    longTermNotes,
    preferredTable ? `[seating] ${preferredTable}` : null,
  ].filter(Boolean).join("\n") || null;

  const upd = await sb.from("guests").update({
    allergies: allergens.length ? allergens.join(", ") : null,
    dietary: dietary.length ? dietary.join(", ") : null,
    birthday,
    notes: notesMerged,
  }).eq("id", payload.g).eq("restaurant_id", r.id);
  if (upd.error) return Response.json({ ok: false, error: "guest update failed" }, { status: 500 });

  // If a booking is attached, pre-populate a guest_visits draft so FOH sees the
  // visit's specific needs on the pass. Match on (guest_id, sales_event_id) is
  // unreliable at this stage — instead, look for an existing draft for the
  // booking's date; upsert-style.
  if (payload.b && visitNeeds) {
    const { data: booking } = await sb.from("bookings").select("service_date").eq("id", payload.b).maybeSingle();
    if (booking?.service_date) {
      const { data: existing } = await sb.from("guest_visits")
        .select("id")
        .eq("guest_id", payload.g)
        .eq("restaurant_id", r.id)
        .eq("visit_date", booking.service_date)
        .maybeSingle();
      if (existing?.id) {
        await sb.from("guest_visits").update({ notes: visitNeeds }).eq("id", existing.id);
      } else {
        await sb.from("guest_visits").insert({
          guest_id: payload.g, restaurant_id: r.id,
          visit_date: booking.service_date, covers: 0,
          notes: visitNeeds,
        });
      }
    }
  }

  return Response.json({ ok: true });
}
