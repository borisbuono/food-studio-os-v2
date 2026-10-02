"use client";
import { useState } from "react";
import type { GuestBrand } from "@/lib/guest/brand";

export type ProposalPrefill = {
  date: string; pax: string; budget_pp: string;
  venue: "" | "ours" | "provider" | "help"; shape: "" | "set" | "sharing" | "buffet" | "canapes"; ref: string;
};

const T = {
  es: {
    name: "Tu nombre", email: "Email", phone: "Teléfono (opcional)", occasion: "¿Qué celebramos?", occasion_ph: "Cumpleaños, cena de empresa, boda, una cena entre amigos…",
    date: "Fecha (aprox.)", pax: "Personas", where: "¿Dónde?", where_opts: { "": "—", ours: "En vuestro local", provider: "Tenemos sitio", help: "Necesitamos un sitio" },
    shape: "Formato", shape_opts: { "": "—", set: "Menú cerrado", sharing: "Para compartir", buffet: "Buffet", canapes: "Canapés / cóctel" },
    budget: "Presupuesto por persona, aprox. (opcional)", budget_hint: "Tu cifra, solo para orientarnos.",
    vibe: "Cuéntanos el ambiente", vibe_ph: "Tranquilo y largo, con vinos; o algo informal y vivo…",
    send: "Pedir la propuesta", sending: "Enviando…", need: "Nombre, email y la ocasión, por favor.",
    thanks: "Gracias", done: "Ya lo tenemos.", done_sub: "Boris te escribe con la propuesta. Si algo cambia, responde al mismo correo.",
    read: "Leímos esto en tu email — corrige lo que no sea así.",
  },
  en: {
    name: "Your name", email: "Email", phone: "Phone (optional)", occasion: "What are we celebrating?", occasion_ph: "A birthday, a company dinner, a wedding lunch, dinner with friends…",
    date: "Date (approx.)", pax: "People", where: "Where?", where_opts: { "": "—", ours: "At your place", provider: "We have a venue", help: "We need a venue" },
    shape: "Format", shape_opts: { "": "—", set: "Set menu", sharing: "Sharing", buffet: "Buffet", canapes: "Canapés / cocktail" },
    budget: "Budget per person, approx. (optional)", budget_hint: "Your figure, only to point us.",
    vibe: "Tell us the mood", vibe_ph: "Long and quiet with wine; or something lively and informal…",
    send: "Ask for the proposal", sending: "Sending…", need: "Name, email and the occasion, please.",
    thanks: "Thank you", done: "We have it.", done_sub: "Boris writes back with the proposal. If anything changes, just reply to the same email.",
    read: "We read this in your email — correct anything that is off.",
  },
} as const;

export default function ProposalForm({ slug, entitySlug, brand, lang, prefill }: { slug: string; entitySlug: string; brand: GuestBrand; lang: "es" | "en"; prefill: ProposalPrefill }) {
  const t = T[lang];
  const [f, setF] = useState({ name: "", email: "", phone: "", occasion: "", date: prefill.date, pax: prefill.pax, venue: prefill.venue, shape: prefill.shape, budget_pp: prefill.budget_pp, vibe: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const prefilled = !!(prefill.date || prefill.pax || prefill.venue || prefill.shape || prefill.budget_pp);

  async function submit() {
    setErr(null);
    if (!f.name.trim() || !f.email.trim() || !f.occasion.trim()) { setErr(t.need); return; }
    setBusy(true);
    try {
      const message = [
        `Occasion: ${f.occasion.trim()}`,
        f.venue ? `Where: ${(t.where_opts as any)[f.venue]}` : "",
        f.shape ? `Format: ${(t.shape_opts as any)[f.shape]}` : "",
        f.budget_pp ? `Budget (their figure): ~${f.budget_pp} €/pp` : "",
        f.vibe.trim() ? `Mood: ${f.vibe.trim()}` : "",
        `Language: ${lang}`,
      ].filter(Boolean).join("\n");
      const res = await fetch("/api/leads/capture", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_slug: entitySlug, source: prefill.ref ? "inbound-email" : "website", intent: "event",
          utm_source: prefill.ref ? "email" : "website", utm_medium: prefill.ref ? "proposal_link" : "proposal_page",
          utm_content: prefill.ref ? `email:${prefill.ref}` : `proposal:${slug}`,
          landing_url: typeof window !== "undefined" ? window.location.href : undefined,
          name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined,
          party_size: f.pax ? Number(f.pax) : undefined, requested_date: f.date || undefined, message,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setOk(true);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally { setBusy(false); }
  }

  if (ok) {
    return (
      <div className="mt-10 rounded-lg p-8" style={{ background: brand.accent + "10", border: `1px solid ${brand.accent}55` }}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>{t.thanks}</p>
        <h2 className={`mt-3 text-[26px] ${brand.displayClass}`} style={{ color: brand.ink }}>{t.done}</h2>
        <p className="mt-4 font-serif italic text-[16px]" style={{ color: brand.inkSoft }}>{t.done_sub}</p>
      </div>
    );
  }

  const lbl = "font-mono text-[10.5px] uppercase tracking-[0.24em]";
  const inp = "mt-1 w-full rounded border bg-transparent px-3 py-2.5 font-sans text-[15px] outline-none";
  const inpStyle = { borderColor: brand.accent + "44", color: brand.ink } as React.CSSProperties;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-10 space-y-5">
      {prefilled ? <p className="font-serif italic text-[14px]" style={{ color: brand.clay }}>{t.read}</p> : null}
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>{t.occasion}</span>
        <input className={inp} style={inpStyle} value={f.occasion} onChange={(e) => setF({ ...f, occasion: e.target.value })} placeholder={t.occasion_ph} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label><span className={lbl} style={{ color: brand.clay }}>{t.date}</span>
          <input type="date" className={inp} style={inpStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label><span className={lbl} style={{ color: brand.clay }}>{t.pax}</span>
          <input inputMode="numeric" className={inp} style={inpStyle} value={f.pax} onChange={(e) => setF({ ...f, pax: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label><span className={lbl} style={{ color: brand.clay }}>{t.where}</span>
          <select className={inp} style={inpStyle} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value as any })}>
            {Object.entries(t.where_opts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span className={lbl} style={{ color: brand.clay }}>{t.shape}</span>
          <select className={inp} style={inpStyle} value={f.shape} onChange={(e) => setF({ ...f, shape: e.target.value as any })}>
            {Object.entries(t.shape_opts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>{t.budget}</span>
        <input inputMode="numeric" className={inp} style={inpStyle} value={f.budget_pp} onChange={(e) => setF({ ...f, budget_pp: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
        <span className="mt-1 block font-serif italic text-[12.5px]" style={{ color: brand.clay }}>{t.budget_hint}</span>
      </label>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>{t.vibe}</span>
        <textarea rows={3} className={inp} style={inpStyle} value={f.vibe} onChange={(e) => setF({ ...f, vibe: e.target.value })} placeholder={t.vibe_ph} />
      </label>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>{t.name}</span>
        <input className={inp} style={inpStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label><span className={lbl} style={{ color: brand.clay }}>{t.email}</span>
          <input type="email" className={inp} style={inpStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
        </label>
        <label><span className={lbl} style={{ color: brand.clay }}>{t.phone}</span>
          <input className={inp} style={inpStyle} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
        </label>
      </div>
      {/* honeypot — humans never see it; bots fill it; the endpoint drops those silently */}
      <input type="text" name="website_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {err ? <p className="font-serif italic text-[14px]" style={{ color: "#9A3122" }}>{err}</p> : null}
      <button type="submit" disabled={busy} className="w-full rounded-full py-3 font-sans text-[14px] tracking-wide disabled:opacity-60" style={{ background: brand.accent, color: "#FBF7EF" }}>
        {busy ? t.sending : t.send}
      </button>
    </form>
  );
}
