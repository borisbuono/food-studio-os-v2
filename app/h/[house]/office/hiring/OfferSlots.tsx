"use client";
import { useState } from "react";

// "Offer interview slots" — one click mints the candidate's interview link and
// drafts the message with 3 free times. Nothing is sent from here.
export default function OfferSlots({ candidateId, phone, email }: { candidateId: string; phone?: string | null; email?: string | null }) {
  const [out, setOut] = useState<any>(null);
  const [lang, setLang] = useState<"es" | "en">("es");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    setBusy(true); setCopied(false);
    const r = await fetch(`/api/hiring/candidates/${candidateId}/offer-slots`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setOut(await r.json().catch(() => ({ ok: false, error: "failed" })));
    setBusy(false);
  };
  const msg = out?.ok ? (lang === "es" ? out.message_es : out.message_en) : "";
  const wa = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(msg)}` : null;
  const mail = email ? `mailto:${email}?subject=${encodeURIComponent(lang === "es" ? "Entrevista" : "Interview")}&body=${encodeURIComponent(msg)}` : null;
  return (
    <div className="mt-2">
      <button onClick={go} disabled={busy} className="rounded border border-black/15 px-2 py-1 text-[11px]">
        {busy ? "…" : out?.ok ? "New link" : "Offer 3 slots (booking link)"}
      </button>
      {out && !out.ok ? (
        <p className="mt-1 text-[11px] text-tomato">
          {out.hint ? <>{out.hint.replace(": /me/booking", ":")} <a className="underline" href="/me/booking">/me/booking</a></> : out.error}
        </p>
      ) : null}
      {out?.ok ? (
        <div className="mt-2 space-y-1">
          <div className="flex gap-1 text-[10px]">
            {(["es", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded px-1.5 py-0.5 ${lang === l ? "bg-ink text-white" : "border border-black/15"}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <textarea readOnly value={msg} rows={8} className="w-full rounded border border-black/15 px-2 py-1 text-[11px]" />
          <div className="flex flex-wrap gap-1 text-[11px]">
            <button onClick={() => { navigator.clipboard?.writeText(msg).then(() => setCopied(true)).catch(() => {}); }} className="rounded border border-black/15 px-2 py-0.5">{copied ? "Copied" : "Copy"}</button>
            {wa ? <a href={wa} target="_blank" className="rounded border border-black/15 px-2 py-0.5">WhatsApp ↗</a> : null}
            {mail ? <a href={mail} className="rounded border border-black/15 px-2 py-0.5">Email ↗</a> : null}
          </div>
          <p className="text-[10px] text-clay">Not sent. The link works once — when they pick a time the interview lands on your calendar and they get a confirmation with the invite.</p>
        </div>
      ) : null}
    </div>
  );
}
