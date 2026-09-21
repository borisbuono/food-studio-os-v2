"use client";

import { useState } from "react";
import { EMPTY_ANSWERS, EXTRA_PERSON_Q, PERSON_Q, SIGNATURE_Q, WORK_STYLE, type ApplyAnswers, type ApplyArea, type ApplyKind, type BrandKit } from "@/lib/hiring-apply";

type Lang = "es" | "en";
type Opening = { id: string; title: string; station: string | null; hours_per_week: number | null };

const T = {
  es: {
    hello: "Trabaja con nosotros",
    lede: (h: string) => `Cocina y sala en ${h}. Trabajo o stage. Unos siete minutos. Nos importa más quién eres que tu CV, y cada candidatura la lee una persona.`,
    area: "¿Dónde?", cocina: "Cocina", sala: "Sala",
    kind: "¿Qué buscas?", job: "Trabajo", s1d: "1 día", s3d: "3 días", s1w: "1 semana",
    jobFull: "Trabajo · jornada completa", jobPart: "Extras · días sueltos",
    stageQ: "¿O prefieres hacer un stage con nosotros?", stageLede: "Un stage formativo de unos días en la cocina o en la sala. Tiene un pequeño coste de formación; te damos el detalle cuando te contactemos. Elige cuánto tiempo:",
    stageDates: "¿Qué fechas te vienen bien para el stage?",
    stationSala: "¿Qué experiencia tienes en sala, vinos o barra, y dónde quieres crecer?",
    needChoice: "Elige qué buscas y dónde: cocina o sala.",
    schedule: "¿Qué jornada?", full: "Completa", part: "Parcial", season: "Temporada",
    foodHandler: "¿Tienes el carnet de manipulador de alimentos?", expired: "Caducado",
    craftTitle: "El oficio", craftLede: "Contesta como se lo contarías a un compañero. Dos o tres frases bastan.",
    wsTitle: "Cómo trabajas", wsLede: "Diez toques rápidos. Elige la que más se parece a ti — no hay respuesta mejor, nos sirve para equilibrar el equipo.",
    wsNeed: "Elige una opción en cada fila.",
    personTitle: "Sobre ti", personLede: "Sin respuestas buenas o malas, y con una frase basta. Queremos saber cómo eres para armar un buen equipo.",
    steps: ["Tú", "CV", "Práctico", "Cómo trabajas", "Sobre ti", "Enviar"],
    name: "Nombre y apellidos", email: "Email", phone: "Teléfono (WhatsApp)",
    role: "¿Algún puesto concreto?", open: "Candidatura espontánea",
    cv: "Sube tu CV", cvHint: "PDF o una foto del papel. Máx. 10 MB.", cvPick: "Elegir archivo o hacer foto",
    note: "¿Algo que quieras contarnos? (opcional)",
    rtw: "¿Tienes permiso de trabajo en España?", yes: "Sí", no: "No", inProgress: "En trámite",
    start: "¿Desde cuándo podrías empezar?", notice: "¿Preaviso en tu trabajo actual?",
    salary: "Expectativa salarial (neto/mes o bruto/año)",
    weekends: "¿Fines de semana y festivos?", some: "Algunos",
    lives: "¿Dónde vives?", transport: (h: string) => (h.includes("Mondo") ? "Estamos en Sant Joan, en el norte. ¿Cómo vendrías?" : "¿Cómo vendrías al trabajo?"),
    refs: "Uno o dos jefes de cocina anteriores como referencia (nombre y contacto)",
    station: "¿En qué partida eres más fuerte y dónde quieres crecer?",
    allergens: "¿Formación en alérgenos y manipulación de alimentos?",
    privacyTitle: "Tus datos",
    privacy: (legal: string, contact: string) =>
      `Responsable: ${legal}. Usamos tus datos solo para gestionar tu candidatura. Una herramienta de IA lee tu CV y ordena tus respuestas para que las revisemos antes; la decisión la toma siempre una persona. Los guardamos un máximo de 12 meses y luego los borramos, salvo que te contratemos. No los cedemos a nadie. Puedes pedir acceso, corrección o borrado cuando quieras en ${contact}.`,
    consent: "He leído lo anterior y acepto que tratéis mis datos para esta candidatura.",
    next: "Siguiente", back: "Atrás", send: "Enviar candidatura", sending: "Enviando…",
    need: "Rellena nombre, email y teléfono.", needCv: "Sube tu CV o cuéntanos tu experiencia en el campo de texto.", needConsent: "Marca la casilla para poder enviarla.",
    thanks: (n: string) => `Gracias, ${n}.`,
    thanksBody: "Tu candidatura ha llegado. La leemos personalmente y te escribimos en unos días.",
  },
  en: {
    hello: "Work with us",
    lede: (h: string) => `Kitchen and front of house at ${h}. Job or stage. About seven minutes. We care more about who you are than your CV, and a person reads every application.`,
    area: "Where?", cocina: "Kitchen", sala: "Front of house", 
    kind: "What are you looking for?", job: "Job", s1d: "1 day", s3d: "3 days", s1w: "1 week",
    jobFull: "Job · full time, full week", jobPart: "Extra shifts · odd days",
    stageQ: "Or would you rather do a stage with us?", stageLede: "A training stage of a few days in the kitchen or on the floor. It carries a small training fee; we give you the details when we get in touch. Choose how long:",
    stageDates: "Which dates suit you for the stage?",
    stationSala: "What experience do you have on the floor, with wine or behind the bar, and where do you want to grow?",
    needChoice: "Choose what you're looking for, and kitchen or front of house.",
    schedule: "Hours?", full: "Full time", part: "Part time", season: "Season",
    foodHandler: "Do you have a food-handler certificate (carnet de manipulador)?", expired: "Expired",
    craftTitle: "The craft", craftLede: "Answer as you'd explain it to a colleague. Two or three sentences are enough.",
    wsTitle: "How you work", wsLede: "Ten quick taps. Pick the one that's more like you — there's no better answer, it helps us balance the team.",
    wsNeed: "Pick one option in each row.",
    personTitle: "About you", personLede: "No right or wrong answers, and one sentence is enough. We want to know who you are so we can build a good team.",
    steps: ["You", "CV", "Practical", "How you work", "About you", "Send"],
    name: "Full name", email: "Email", phone: "Phone (WhatsApp)",
    role: "A specific opening?", open: "Open application",
    cv: "Upload your CV", cvHint: "PDF or a photo of the paper. Max 10 MB.", cvPick: "Choose file or take photo",
    note: "Anything you'd like to tell us? (optional)",
    rtw: "Do you have the right to work in Spain?", yes: "Yes", no: "No", inProgress: "In progress",
    start: "When could you start?", notice: "Notice at your current job?",
    salary: "Salary expectation (net/month or gross/year)",
    weekends: "Weekends and bank holidays?", some: "Some",
    lives: "Where do you live?", transport: (h: string) => (h.includes("Mondo") ? "We're in Sant Joan, in the north. How would you get here?" : "How would you get to work?"),
    refs: "One or two previous head chefs as references (name and contact)",
    station: "Which station are you strongest on, and where do you want to grow?",
    allergens: "Allergen and food-handling training?",
    privacyTitle: "Your data",
    privacy: (legal: string, contact: string) =>
      `Controller: ${legal}. We use your details only to handle your application. An AI tool reads your CV and sorts your answers so we can review them faster; a person always makes the decision. We keep them for at most 12 months and then delete them, unless we hire you. We never share them. Ask for access, correction or deletion any time at ${contact}.`,
    consent: "I've read the above and agree to you processing my details for this application.",
    next: "Next", back: "Back", send: "Send application", sending: "Sending…",
    need: "Fill in name, email and phone.", needCv: "Upload your CV or tell us about your experience in the text box.", needConsent: "Tick the box to send it.",
    thanks: (n: string) => `Thank you, ${n}.`,
    thanksBody: "Your application is in. We read it ourselves and will write to you within a few days.",
  },
};

export default function ApplyForm(props: {
  slug: string;
  houseName: string;
  legalName: string;
  accent: string;
  contact: string;
  brandKit: BrandKit;
  openings: Opening[];
  preselect: string;
  initialLang: Lang;
  initialArea: string;
  initialKind: string;
  source: string;
  utm: string;
  embed?: boolean;
}) {
  const { slug, houseName, legalName, accent, contact, brandKit, openings, embed = false } = props;
  // Brand values (fall back to something neutral if brand_kit is missing).
  const ground = brandKit?.palette?.ground || "#faf8f5";
  const ink = brandKit?.palette?.ink || "#111827";
  const displayFamily = brandKit?.typography?.display?.family;
  const bodyFamily = brandKit?.typography?.body?.family;
  const displayFont = displayFamily ? `"${displayFamily}", Georgia, serif` : "Georgia, serif";
  const bodyFont = bodyFamily ? `"${bodyFamily}", system-ui, -apple-system, Segoe UI, sans-serif` : "system-ui, -apple-system, Segoe UI, sans-serif";
  // Embed mode strips the outer chrome (bg + top padding + full-viewport
  // height) so the page sits flush inside a Wix iframe on the venue sites.
  const outerBg = embed ? "transparent" : ground;
  const mainClass = embed ? "px-5 pb-16 pt-4" : "min-h-screen px-5 pb-24 pt-8";
  const doneClass = embed ? "px-5 py-10" : "min-h-screen px-5 py-16";
  const [lang, setLang] = useState<Lang>(props.initialLang);
  const t = T[lang];
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [opening, setOpening] = useState(openings.find((o) => o.id === props.preselect)?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [a, setA] = useState<ApplyAnswers>({
    ...EMPTY_ANSWERS,
    area: (["cocina", "sala"].includes(props.initialArea) ? props.initialArea : "") as ApplyArea | "",
    kind: (["job", "stage_1d", "stage_3d", "stage_1w"].includes(props.initialKind) ? props.initialKind : "") as ApplyKind | "",
  });
  const isStage = !!a.kind && a.kind !== "job";
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const set = (k: keyof ApplyAnswers) => (v: string) => setA((p) => ({ ...p, [k]: v }));

  function go(n: number) {
    setErr("");
    if (n > 0 && step === 0 && (!a.area || !a.kind)) return setErr(t.needChoice);
    if (n > 0 && step === 0 && (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone.trim())) return setErr(t.need);
    if (n > 1 && step === 1 && !file && !a.note.trim()) return setErr(t.needCv);
    if (n > 3 && step === 3 && WORK_STYLE.some((w) => !a.work_style[w.k])) return setErr(t.wsNeed);
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    if (!consent) return setErr(t.needConsent);
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("email", email);
      fd.set("phone", phone);
      if (opening) fd.set("job_opening_id", opening);
      if (file) fd.set("file", file);
      for (const [k, v] of Object.entries(a)) fd.set(k, typeof v === "string" ? v : JSON.stringify(v));
      fd.set("consent", "yes");
      fd.set("company", hp);
      fd.set("source", props.source);
      fd.set("utm", props.utm);
      fd.set("lang", lang);
      const r = await fetch(`/api/public/apply/${slug}`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return setErr(j.error || `Error ${r.status}`);
      setDone(true);
    } catch {
      setErr(lang === "es" ? "No se pudo enviar. Revisa la conexión y vuelve a intentarlo." : "Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-3 text-base outline-none focus:border-black";
  const label = "mt-5 block text-sm font-medium";
  const btn = "rounded-full px-6 py-3 text-base font-medium text-white disabled:opacity-50";

  const choice = (k: keyof ApplyAnswers, opts: Array<[string, string]>) => (
    <ChoiceRow value={String(a[k] ?? "")} opts={opts} accent={accent} onPick={(v) => set(k)(v)} />
  );


  if (done)
    return (
      <main className={doneClass} style={{ background: outerBg, color: ink, fontFamily: bodyFont }}>
        <div className="mx-auto max-w-md">
          <p className="text-xs uppercase tracking-[0.2em]" style={{ color: accent }}>{houseName}</p>
          <h1 className="mt-3 text-3xl" style={{ fontFamily: displayFont }}>{t.thanks(name.split(" ")[0] || name)}</h1>
          <p className="mt-4 text-lg leading-relaxed opacity-80">{t.thanksBody}</p>
        </div>
      </main>
    );

  return (
    <main className={mainClass} style={{ background: outerBg, color: ink, fontFamily: bodyFont }}>
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em]" style={{ color: accent }}>{houseName} · Ibiza</p>
          <div className="flex overflow-hidden rounded-full border border-black/20 text-xs">
            {(["es", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="px-3 py-1.5"
                style={lang === l ? { background: accent, color: "#fff" } : undefined}
              >
                {l === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
        </div>
        <h1 className="mt-4 text-3xl leading-tight" style={{ fontFamily: displayFont }}>{t.hello}</h1>
        <p className="mt-2 opacity-70">{t.lede(houseName)}</p>

        <ol className="mt-6 flex gap-1.5">
          {t.steps.map((s, i) => (
            <li key={s} className="flex-1">
              <div className="h-1 rounded-full" style={{ background: i <= step ? accent : "rgba(0,0,0,.1)" }} />
              <div className={`mt-1 text-[11px] ${i === step ? "font-medium" : "opacity-60"}`}>{s}</div>
            </li>
          ))}
        </ol>

        {/* honeypot */}
        <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" aria-hidden name="company" />

        {step === 0 && (
          <section>
            <p className={label}>{t.kind}</p>
            <div className="mt-2 grid gap-2">
              {([["full", t.jobFull], ["extras", t.jobPart]] as const).map(([sch, l]) => {
                const on = a.kind === "job" && a.schedule === sch;
                return (
                  <button
                    type="button"
                    key={sch}
                    onClick={() => setA((p) => ({ ...p, kind: "job", schedule: sch }))}
                    className="rounded-xl border px-4 py-3 text-left text-base"
                    style={on ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: "rgba(0,0,0,.2)", background: "#fff" }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 rounded-xl border border-dashed border-black/20 bg-white/60 p-4">
              <p className="text-sm font-medium">{t.stageQ}</p>
              <p className="mt-1 text-xs opacity-70">{t.stageLede}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {([["stage_1d", t.s1d], ["stage_3d", t.s3d], ["stage_1w", t.s1w]] as const).map(([k, l]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setA((p) => ({ ...p, kind: k, schedule: "" }))}
                    className="rounded-full border px-4 py-2 text-sm"
                    style={a.kind === k ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: "rgba(0,0,0,.2)" }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <p className={label}>{t.area}</p>
            {choice("area", [["cocina", t.cocina], ["sala", t.sala]])}
            <label className={label}>{t.name}<input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className={label}>{t.email}<input className={input} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <label className={label}>{t.phone}<input className={input} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></label>
            {openings.length ? (
            <label className={label}>
              {t.role}
              <select className={input} value={opening} onChange={(e) => setOpening(e.target.value)}>
                <option value="">{t.open}</option>
                {openings.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </label>
            ) : null}
          </section>
        )}

        {step === 1 && (
          <section>
            <p className={label}>{t.cv}</p>
            <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-black/20 bg-white px-4 py-8 text-center">
              <span className="text-base font-medium">{file ? file.name : t.cvPick}</span>
              <span className="mt-1 text-xs opacity-60">{t.cvHint}</span>
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <label className={label}>{t.note}<textarea className={input} rows={4} value={a.note} onChange={(e) => set("note")(e.target.value)} /></label>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className={label}>{t.rtw}</p>
            {choice("right_to_work", [["yes", t.yes], ["in_progress", t.inProgress], ["no", t.no]])}
            {isStage ? (
              <label className={label}>{t.stageDates}<input className={input} value={a.stage_dates} onChange={(e) => set("stage_dates")(e.target.value)} /></label>
            ) : (
              <>
                <label className={label}>{t.start}<input className={input} type="date" value={a.start_date} onChange={(e) => set("start_date")(e.target.value)} /></label>
                <label className={label}>{t.notice}<input className={input} value={a.notice} onChange={(e) => set("notice")(e.target.value)} /></label>
                <label className={label}>{t.salary}<input className={input} value={a.salary} onChange={(e) => set("salary")(e.target.value)} /></label>
              </>
            )}
            <p className={label}>{t.weekends}</p>
            {choice("weekends", [["yes", t.yes], ["some", t.some], ["no", t.no]])}
            <label className={label}>{t.lives}<input className={input} value={a.lives_where} onChange={(e) => set("lives_where")(e.target.value)} /></label>
            <label className={label}>{t.transport(houseName)}<input className={input} value={a.transport} onChange={(e) => set("transport")(e.target.value)} /></label>
            <label className={label}>{t.refs}<textarea className={input} rows={2} value={a.references} onChange={(e) => set("references")(e.target.value)} /></label>
            <p className={label}>{t.allergens}</p>
            {choice("allergen_training", [["yes", t.yes], ["no", t.no]])}
            <p className={label}>{t.foodHandler}</p>
            {choice("food_handler", [["yes", t.yes], ["expired", t.expired], ["no", t.no]])}
          </section>
        )}

        {step === 3 && (
          <section>
            <h2 className="mt-6 text-xl" style={{ fontFamily: displayFont }}>{t.wsTitle}</h2>
            <p className="mt-1 text-sm opacity-70">{t.wsLede}</p>
            {WORK_STYLE.map((w) => (
              <div key={w.k} className="mt-5">
                <p className="text-xs uppercase tracking-wide opacity-60">{w.dim[lang]}</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(["a", "b"] as const).map((side) => {
                    const on = a.work_style[w.k] === side;
                    return (
                      <button
                        type="button"
                        key={side}
                        onClick={() => setA((p) => ({ ...p, work_style: { ...p.work_style, [w.k]: side } }))}
                        className="rounded-xl border px-3 py-3 text-left text-sm leading-snug"
                        style={on ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: "rgba(0,0,0,.2)", background: "#fff" }}
                      >
                        {w[side][lang]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {step === 4 && (
          <section>
            <h2 className="mt-6 text-xl" style={{ fontFamily: displayFont }}>{t.personTitle}</h2>
            <p className="mt-1 text-sm opacity-70">{t.personLede}</p>
            <label className={label}>
              {SIGNATURE_Q[a.area === "sala" ? "sala" : "cocina"][lang]}
              <textarea className={input} rows={2} value={a.craft1} onChange={(e) => set("craft1")(e.target.value)} />
            </label>
            {PERSON_Q.map((q) => (
              <label key={q.k} className={label}>
                {q[lang](a.area)}
                <textarea className={input} rows={2} value={a[q.k]} onChange={(e) => set(q.k)(e.target.value)} />
              </label>
            ))}
            {(["p_why", "p_proud"] as const).map((k) => (
              <label key={k} className={label}>
                {EXTRA_PERSON_Q[k][lang]}
                <textarea className={input} rows={2} value={a[k]} onChange={(e) => set(k)(e.target.value)} />
              </label>
            ))}
          </section>
        )}

        {step === 5 && (
          <section>
            <div className="mt-5 rounded-xl border border-black/10 bg-white p-4 text-sm leading-relaxed">
              <p className="font-medium">{name} · {email} · {phone}</p>
              <p className="mt-1 opacity-70">{file ? file.name : "—"}</p>
            </div>
            <p className={label}>{t.privacyTitle}</p>
            <p className="mt-1 text-sm leading-relaxed opacity-80">{t.privacy(legalName, contact)}</p>
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t.consent}</span>
            </label>
          </section>
        )}

        {err ? <p className="mt-4 text-sm text-red-700">{err}</p> : null}

        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <button onClick={() => go(step - 1)} className="text-sm underline" disabled={busy}>{t.back}</button>
          ) : <span />}
          {step < 5 ? (
            <button onClick={() => go(step + 1)} className={btn} style={{ background: accent }}>{t.next}</button>
          ) : (
            <button onClick={submit} disabled={busy} className={btn} style={{ background: accent }}>{busy ? t.sending : t.send}</button>
          )}
        </div>
      </div>
    </main>
  );
}

// Top-level so it keeps its identity between renders: a component declared
// inside the form remounts on every keystroke/tap, which can swallow taps on
// mobile Safari.
function ChoiceRow({
  value,
  opts,
  accent,
  onPick,
}: {
  value: string;
  opts: Array<[string, string]>;
  accent: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {opts.map(([v, l]) => (
        <button
          type="button"
          key={v}
          onClick={() => onPick(v)}
          className="rounded-full border px-4 py-2 text-sm"
          style={value === v ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: "rgba(0,0,0,.2)" }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
