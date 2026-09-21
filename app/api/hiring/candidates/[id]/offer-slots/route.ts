import { supabaseServer } from "@/lib/supabaseServer";
import { applyClient } from "@/lib/hiring-apply";
import { appOrigin } from "@/lib/email/invite";
import { computeSlots, type BookingInfo, type Busy } from "@/lib/calendarBooking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hiring/candidates/<id>/offer-slots
// Mints a one-shot interview link on the candidate (offer_interview_slots RPC,
// member of the candidate's venue only) and returns the next 3 free slots on
// the interviewer's /book page plus drafted ES/EN messages. NOTHING is sent —
// Boris copies it into WhatsApp / email himself.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as any;
  const { data, error } = await sb.rpc("offer_interview_slots", {
    p_candidate: params.id, p_interviewer: body.interviewer || null,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  const r: any = data;
  if (!r?.ok) {
    return Response.json({
      ok: false, error: r?.error || "failed",
      hint: r?.error === "no_booking_profile" ? "Set up your booking page first: /me/booking" : undefined,
    }, { status: 409 });
  }
  const anon = applyClient();
  const { data: infoRaw } = await anon.rpc("booking_page_info", { p_slug: r.slug });
  const info = infoRaw as BookingInfo | null;
  let slots: string[] = [];
  if (info) {
    const { data: busy } = await anon.rpc("booking_busy", {
      p_slug: r.slug, p_from: new Date().toISOString(), p_to: new Date(Date.now() + (info.days_ahead + 1) * 86400_000).toISOString(),
    });
    // three slots on three different days where possible
    const days = computeSlots(info, (busy || []) as Busy[], "interview");
    for (const d of days) { if (slots.length < 3) slots.push(d.slots[0]); }
    if (slots.length < 3) for (const d of days) for (const s of d.slots.slice(1)) if (slots.length < 3) slots.push(s);
    slots.sort();
  }
  const origin = appOrigin(new URL(req.url).origin);
  const qs = `intent=interview&candidate=${params.id}&k=${r.token}`;
  const link_es = `${origin}/book/${r.slug}?${qs}&lang=es`;
  const link_en = `${origin}/book/${r.slug}?${qs}&lang=en`;
  const tz = info?.tz || "Europe/Madrid";
  const f = (lang: string) => new Intl.DateTimeFormat(lang, { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const first = String(r.candidate_name || "").split(" ")[0] || "";
  const venue = info?.venue || "";
  const list = (lang: string) => slots.map((s) => `• ${f(lang).format(new Date(s))}`).join("\n");
  const message_es = `Hola ${first}, gracias por escribirnos. Nos gustaría conocerte en ${venue}.\n\n` +
    (slots.length ? `Tenemos estos huecos:\n${list("es-ES")}\n\n` : "") +
    `Elige el que mejor te venga aquí (o cualquier otro que veas libre):\n${link_es}`;
  const message_en = `Hi ${first}, thanks for getting in touch. We'd like to meet you at ${venue}.\n\n` +
    (slots.length ? `These times are open:\n${list("en-GB")}\n\n` : "") +
    `Pick the one that suits you here (or any other free time):\n${link_en}`;
  return Response.json({ ok: true, link: link_es, link_en, slots, tz, message_es, message_en });
}
