// calendarBooking.ts — slot maths, .ics and emails for /book/<slug>.
// Pure helpers are client-safe; sendBookingEmails is server-only (fetch to Resend).
import { addDaysYmd, zonedParts, zonedToUtc } from "@/lib/calendar";

export type BookingInfo = {
  slug: string; name: string; intro: string | null; venue: string; venue_slug: string; tz: string;
  slot_minutes: number; buffer_minutes: number; min_notice_hours: number; days_ahead: number;
  hours: Record<string, [string, string][]>; location: string | null; accent: string | null;
};
export type Busy = { start_ts: string; end_ts: string };
export type DaySlots = { ymd: string; slots: string[] };   // ISO starts

export const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function durationFor(info: Pick<BookingInfo, "slot_minutes">, intent: string | null) {
  return intent === "interview" ? Math.max(info.slot_minutes, 45) : info.slot_minutes;
}

export function computeSlots(info: BookingInfo, busy: Busy[], intent: string | null, now = Date.now()): DaySlots[] {
  const tz = info.tz;
  const dur = durationFor(info, intent) * 60_000;
  const step = info.slot_minutes * 60_000;
  const buf = info.buffer_minutes * 60_000;
  const earliest = now + info.min_notice_hours * 3600_000;
  const blocks = busy.map((b) => [Date.parse(b.start_ts) - buf, Date.parse(b.end_ts) + buf] as const);
  const today = zonedParts(new Date(now), tz).ymd;
  const out: DaySlots[] = [];
  for (let i = 0; i <= info.days_ahead; i++) {
    const ymd = addDaysYmd(today, i);
    const key = zonedParts(zonedToUtc(ymd, 12, 0, tz), tz).weekday.toLowerCase().slice(0, 3);
    const windows = (info.hours?.[key] || []) as [string, string][];
    const slots: string[] = [];
    for (const [a, b] of windows) {
      const [ah, am] = a.split(":").map(Number);
      const [bh, bm] = b.split(":").map(Number);
      const winStart = zonedToUtc(ymd, ah, am, tz).getTime();
      const winEnd = bh === 24 ? zonedToUtc(addDaysYmd(ymd, 1), 0, 0, tz).getTime() : zonedToUtc(ymd, bh, bm, tz).getTime();
      for (let t = winStart; t + dur <= winEnd; t += step) {
        if (t < earliest) continue;
        if (blocks.some(([s, e]) => t < e && t + dur > s)) continue;
        slots.push(new Date(t).toISOString());
      }
    }
    if (slots.length) out.push({ ymd, slots });
  }
  return out;
}

function icsDate(iso: string) {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function icsEsc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
export function buildIcs(o: { uid: string; start: string; end: string; title: string; location?: string | null; description?: string | null; organizerEmail?: string | null }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Food Studio OS//Calendar//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${o.uid}@foodstudio.ai`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(new Date(o.start).toISOString())}`, `DTEND:${icsDate(new Date(o.end).toISOString())}`,
    `SUMMARY:${icsEsc(o.title)}`,
  ];
  if (o.location) lines.push(`LOCATION:${icsEsc(o.location)}`);
  if (o.description) lines.push(`DESCRIPTION:${icsEsc(o.description)}`);
  if (o.organizerEmail) lines.push(`ORGANIZER:mailto:${o.organizerEmail}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function whenLabel(iso: string, tz: string, lang: "es" | "en" = "es") {
  return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

async function resend(to: string, subject: string, html: string, ics?: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const from = process.env.GUEST_EMAIL_FROM || process.env.INVITE_EMAIL_FROM || "Food Studios <no-reply@foodstudios.local>";
  const body: any = { from, to: [to], subject, html };
  if (ics) body.attachments = [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64") }];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });
    return r.ok ? { ok: true } : { ok: false, error: `resend ${r.status}` };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Confirmation to the visitor (with .ics) + a heads-up to the host.
export async function sendBookingEmails(o: {
  kind: "meeting" | "interview"; guestName: string; guestEmail: string; hostName: string; hostEmail: string | null;
  venue: string; location: string | null; start: string; end: string; tz: string; eventId: string; note?: string | null;
  lang?: "es" | "en";
}) {
  const lang = o.lang || "es";
  const title = o.kind === "interview"
    ? (lang === "es" ? `Entrevista · ${o.venue}` : `Interview · ${o.venue}`)
    : `${o.hostName} · ${o.venue}`;
  const ics = buildIcs({ uid: o.eventId, start: o.start, end: o.end, title, location: o.location, description: o.note || null, organizerEmail: o.hostEmail });
  const when = whenLabel(o.start, o.tz, lang);
  const card = (h: string, p: string) => `<!doctype html><html><body style="font-family:Georgia,serif;background:#EFEEEB;margin:0;padding:32px">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#FBF7EF;padding:32px;border-radius:6px"><tr><td>
<h1 style="font-weight:300;font-size:24px;color:#171511;margin:0 0 16px">${h}</h1>${p}
<p style="font-family:monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#7A7A75;margin:24px 0 0">Food Studios</p>
</td></tr></table></body></html>`;
  const guestHtml = card(
    lang === "es" ? "Reservado" : "Booked",
    `<p style="font-size:17px;color:#3A352D;margin:0 0 8px">${esc(when)}</p>
     <p style="font-size:15px;color:#3A352D;margin:0 0 8px">${lang === "es" ? "Con" : "With"} ${esc(o.hostName)} · ${esc(o.venue)}</p>
     ${o.location ? `<p style="font-size:15px;color:#7A7A75;margin:0">${esc(o.location)}</p>` : ""}
     <p style="font-size:13px;color:#7A7A75;margin:16px 0 0">${lang === "es" ? "Adjuntamos la invitación para tu calendario. Si no puedes venir, responde a este correo." : "The calendar invite is attached. If you can't make it, reply to this email."}</p>`,
  );
  const guest = await resend(o.guestEmail, title, guestHtml, ics);
  let host: { ok: boolean; error?: string } = { ok: false, error: "no host email" };
  if (o.hostEmail) {
    host = await resend(o.hostEmail, `${o.kind === "interview" ? "Interview" : "Booking"} · ${o.guestName} · ${whenLabel(o.start, o.tz, "en")}`,
      card(`${esc(o.guestName)} booked you`, `<p style="font-size:16px;color:#3A352D">${esc(whenLabel(o.start, o.tz, "en"))}</p>${o.note ? `<p style="color:#3A352D">${esc(o.note)}</p>` : ""}<p style="color:#7A7A75;font-size:13px">It's on your OS calendar.</p>`), ics);
  }
  return { guest, host, ics };
}
