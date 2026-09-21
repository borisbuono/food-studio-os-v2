import { applyClient } from "@/lib/hiring-apply";
import { extractClientIp, hashIp } from "@/lib/leads/rateLimit";
import { computeSlots, sendBookingEmails, type BookingInfo, type Busy } from "@/lib/calendarBooking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public booking API (anon). Everything goes through definer RPCs:
//   GET  → booking_page_info + booking_busy → open slots (no titles leave the DB)
//   POST → booking_create (re-validates hours / notice / overlap, rate-capped),
//          then confirmation email + .ics to the visitor and a heads-up to the host.
async function info(slug: string) {
  const sb = applyClient();
  const { data } = await sb.rpc("booking_page_info", { p_slug: slug });
  return { sb, info: (data || null) as BookingInfo | null };
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const intent = new URL(req.url).searchParams.get("intent");
  const { sb, info: i } = await info(params.slug);
  if (!i) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const from = new Date();
  const to = new Date(Date.now() + (i.days_ahead + 1) * 86400_000);
  const { data: busy } = await sb.rpc("booking_busy", { p_slug: params.slug, p_from: from.toISOString(), p_to: to.toISOString() });
  const days = computeSlots(i, (busy || []) as Busy[], intent);
  return Response.json({ ok: true, info: i, days }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const b = (await req.json().catch(() => ({}))) as any;
  const start = b.start ? new Date(b.start) : null;
  if (!start || isNaN(start.getTime())) return Response.json({ ok: false, error: "slot_unavailable" }, { status: 400 });
  const intent = b.intent === "interview" ? "interview" : "meeting";
  const uuid = /^[0-9a-f-]{36}$/i;
  const sb = applyClient();
  const { data, error } = await sb.rpc("booking_create", {
    p_slug: params.slug, p_start: start.toISOString(),
    p_name: String(b.name || "").slice(0, 120), p_email: String(b.email || "").slice(0, 200),
    p_phone: b.phone ? String(b.phone).slice(0, 40) : null, p_note: b.note ? String(b.note).slice(0, 1000) : null,
    p_intent: intent,
    p_candidate: uuid.test(String(b.candidate || "")) ? b.candidate : null,
    p_token: uuid.test(String(b.k || "")) ? b.k : null,
    p_ip_hash: hashIp(extractClientIp(req)),
  });
  if (error) return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  const r: any = data;
  if (!r?.ok) {
    const code = r?.error || "error";
    const status = code === "rate_limited" ? 429 : code === "slot_taken" ? 409 : 400;
    return Response.json({ ok: false, error: code }, { status });
  }
  const mail = await sendBookingEmails({
    kind: r.kind, guestName: String(b.name).trim(), guestEmail: String(b.email).trim(), hostName: r.with,
    hostEmail: r.host_email || null, venue: r.venue, location: r.location, start: r.start, end: r.end, tz: r.tz,
    eventId: r.event_id || r.interview_id || crypto.randomUUID(), note: b.note || null, lang: b.lang === "en" ? "en" : "es",
  });
  // host_email never goes back to the browser
  return Response.json({
    ok: true, kind: r.kind, start: r.start, end: r.end, tz: r.tz, with: r.with, venue: r.venue,
    location: r.location, emailed: mail.guest.ok, ics: mail.ics,
  });
}
