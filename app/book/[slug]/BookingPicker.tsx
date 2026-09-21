"use client";
import { useEffect, useMemo, useState } from "react";
import type { BookingInfo, DaySlots } from "@/lib/calendarBooking";
import { durationFor } from "@/lib/calendarBooking";

const T = {
  es: {
    book: "Reserva un hueco con", interview: "Elige hora para tu entrevista en", pick: "Elige día y hora",
    none: "No hay huecos libres en los próximos días.", name: "Nombre", email: "Email", phone: "Teléfono (opcional)",
    note: "Algo que debamos saber (opcional)", confirm: "Confirmar", back: "Cambiar hora", done: "¡Hecho!",
    sent: "Te hemos enviado la confirmación por email.", notSent: "Guarda la invitación en tu calendario:", ics: "Añadir al calendario (.ics)",
    min: "min", tz: "Hora de", errors: {
      slot_taken: "Ese hueco se acaba de ocupar. Elige otro.", slot_unavailable: "Ese hueco ya no está disponible.",
      rate_limited: "Demasiados intentos. Prueba en un rato.", name_and_email_required: "Nombre y email, por favor.",
      invalid_interview_link: "Este enlace de entrevista ya no es válido. Pídenos uno nuevo.", default: "No se pudo reservar.",
    } as Record<string, string>,
  },
  en: {
    book: "Book time with", interview: "Pick a time for your interview at", pick: "Pick a day and time",
    none: "No free slots in the coming days.", name: "Name", email: "Email", phone: "Phone (optional)",
    note: "Anything we should know (optional)", confirm: "Confirm", back: "Change time", done: "Booked",
    sent: "We've emailed you the confirmation.", notSent: "Save the invite to your calendar:", ics: "Add to calendar (.ics)",
    min: "min", tz: "Times in", errors: {
      slot_taken: "That slot was just taken. Pick another.", slot_unavailable: "That slot is no longer available.",
      rate_limited: "Too many attempts. Try again later.", name_and_email_required: "Name and email, please.",
      invalid_interview_link: "This interview link is no longer valid. Ask us for a new one.", default: "Could not book.",
    } as Record<string, string>,
  },
};

export default function BookingPicker({ slug, info, intent, candidate, token, lang: initialLang }: {
  slug: string; info: BookingInfo; intent: "meeting" | "interview"; candidate: string | null; token: string | null; lang: "es" | "en";
}) {
  const [lang, setLang] = useState<"es" | "en">(initialLang);
  const t = T[lang];
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const load = async () => {
    const r = await fetch(`/api/public/book/${slug}?intent=${intent}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    const d: DaySlots[] = j?.ok ? j.days : [];
    setDays(d);
    setDay((cur) => (cur && d.some((x) => x.ymd === cur) ? cur : d[0]?.ymd || null));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = useMemo(() => ({
    day: new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { timeZone: info.tz, weekday: "short", day: "numeric", month: "short" }),
    time: new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { timeZone: info.tz, hour: "2-digit", minute: "2-digit" }),
    long: new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { timeZone: info.tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
  }), [lang, info.tz]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot) return;
    setBusy(true); setErr(null);
    const r = await fetch(`/api/public/book/${slug}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, start: slot, intent, candidate, k: token, lang }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.ok) { setDone(j); return; }
    setErr(t.errors[j.error] || t.errors.default);
    if (j.error === "slot_taken" || j.error === "slot_unavailable") { setSlot(null); load(); }
  };

  const icsHref = done?.ics ? `data:text/calendar;charset=utf-8,${encodeURIComponent(done.ics)}` : null;
  const accent = info.accent || "#171511";
  const current = days?.find((d) => d.ymd === day);

  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.2em]" style={{ color: accent }}>{info.venue}</p>
            <h1 className="mt-1 font-serif text-3xl text-ink">
              {intent === "interview" ? `${t.interview} ${info.venue}` : `${t.book} ${info.name}`}
            </h1>
            <p className="mt-1 text-sm text-clay">
              {durationFor(info, intent)} {t.min}{info.location ? ` · ${info.location}` : ""}
            </p>
            {info.intro ? <p className="mt-3 text-sm text-ink-soft">{info.intro}</p> : null}
          </div>
          <button onClick={() => setLang(lang === "es" ? "en" : "es")} className="rounded border border-black/15 px-2 py-1 text-xs">
            {lang === "es" ? "EN" : "ES"}
          </button>
        </div>

        {done ? (
          <section className="mt-8 rounded border border-black/10 bg-white p-6">
            <h2 className="font-serif text-2xl">{t.done}</h2>
            <p className="mt-2 text-lg">{fmt.long.format(new Date(done.start))}</p>
            <p className="text-sm text-clay">{done.with} · {done.venue}{done.location ? ` · ${done.location}` : ""}</p>
            <p className="mt-4 text-sm">{done.emailed ? t.sent : t.notSent}</p>
            {icsHref ? <a href={icsHref} download="invite.ics" className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white">{t.ics}</a> : null}
          </section>
        ) : slot ? (
          <form onSubmit={submit} className="mt-8 space-y-3 rounded border border-black/10 bg-white p-6">
            <p className="text-lg">{fmt.long.format(new Date(slot))}</p>
            <button type="button" onClick={() => setSlot(null)} className="text-xs text-clay underline">{t.back}</button>
            <input required placeholder={t.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border border-black/15 px-3 py-2.5 text-base" autoComplete="name" />
            <input required type="email" placeholder={t.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded border border-black/15 px-3 py-2.5 text-base" autoComplete="email" />
            <input type="tel" placeholder={t.phone} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded border border-black/15 px-3 py-2.5 text-base" autoComplete="tel" />
            <textarea placeholder={t.note} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full rounded border border-black/15 px-3 py-2.5 text-base" rows={3} />
            {err ? <p className="text-sm text-tomato">{err}</p> : null}
            <button disabled={busy} className="w-full rounded py-3 text-sm text-white" style={{ background: accent }}>
              {busy ? "…" : t.confirm}
            </button>
          </form>
        ) : (
          <section className="mt-8">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-clay">{t.pick}</h2>
            {err ? <p className="mt-2 text-sm text-tomato">{err}</p> : null}
            {days === null ? <p className="mt-3 text-sm text-clay">…</p> : !days.length ? <p className="mt-3 text-sm text-clay">{t.none}</p> : (
              <>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  {days.map((d) => (
                    <button key={d.ymd} onClick={() => setDay(d.ymd)}
                      className={`shrink-0 rounded border px-3 py-2 text-sm ${d.ymd === day ? "border-ink bg-ink text-white" : "border-black/15 bg-white"}`}>
                      {fmt.day.format(new Date(d.slots[0]))}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {current?.slots.map((s) => (
                    <button key={s} onClick={() => { setSlot(s); setErr(null); }}
                      className="rounded border border-black/15 bg-white py-3 text-sm tabular-nums hover:border-ink">
                      {fmt.time.format(new Date(s))}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-4 text-[11px] text-clay">{t.tz} {info.tz.replace("_", " ")}</p>
          </section>
        )}
      </div>
    </main>
  );
}
