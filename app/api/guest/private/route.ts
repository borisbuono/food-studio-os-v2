import { guestServiceClient } from "@/lib/guest/serviceClient";
import { validEmail, sanitizePhone } from "@/lib/guest/booking";

export const runtime = "nodejs";

// POST /api/guest/private — private-event enquiry from /m/[slug]/private.
// Creates a guests row (source = 'private_event') and a lead in sales_events
// with status = 'lead' + primary_guest_id linked. Absorbing the enquiry into
// sales_events keeps it in the same funnel Boris already reviews.
export async function POST(req: Request) {
  const sb = guestServiceClient;
  let body: any = {};
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad JSON" }, { status: 400 }); }

  const slug = String(body.slug || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = sanitizePhone(String(body.phone || ""));
  const description = String(body.description || "").trim();

  if (!slug || !name || !email || !description) {
    return Response.json({ ok: false, error: "name, email and description are required" }, { status: 400 });
  }
  if (!validEmail(email)) return Response.json({ ok: false, error: "email looks off" }, { status: 400 });

  const { data: r } = await sb.from("restaurants").select("id,name").eq("public_slug", slug).maybeSingle();
  if (!r) return Response.json({ ok: false, error: "venue not found" }, { status: 404 });

  // Upsert guest.
  const { data: existing } = await sb.from("guests")
    .select("id").eq("restaurant_id", r.id).eq("email", email).limit(1).maybeSingle();

  let guest_id: string;
  if (existing?.id) {
    guest_id = existing.id;
    await sb.from("guests").update({ name, phone: phone || undefined }).eq("id", guest_id);
  } else {
    const ins = await sb.from("guests").insert({
      restaurant_id: r.id, name, email, phone: phone || null,
      notes: `Private event enquiry — ${description.slice(0, 200)}`,
      source: "private_event",
    }).select("id").single();
    if (ins.error || !ins.data) return Response.json({ ok: false, error: "guest save failed" }, { status: 500 });
    guest_id = ins.data.id;
  }

  // sales_events lead. Guard: if the table doesn't exist in this env, log and continue.
  const partySize = body.party_size ? Number(body.party_size) : null;
  const evDate = String(body.event_date || "") || null;
  try {
    await sb.from("sales_events").insert({
      restaurant_id: r.id,
      title: `Private event — ${name}`,
      event_type: "private_event",
      status: "lead",
      client_name: name,
      event_date: evDate,
      guests_count: partySize,
      theme: description,
      primary_guest_id: guest_id,
    });
  } catch (e) {
    // sales_events may not exist in every environment — the lead is still
    // captured on the guests row (source + notes).
  }

  return Response.json({ ok: true, guest_id });
}
