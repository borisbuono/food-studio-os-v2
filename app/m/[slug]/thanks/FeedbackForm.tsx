"use client";
import { useState } from "react";
import type { GuestBrand } from "@/lib/guest/brand";

export default function FeedbackForm({ slug, token, guestEmail, brand }: { slug: string; token: string; guestEmail: string | null; brand: GuestBrand }) {
  const [rating, setRating] = useState<number>(0);
  const [body, setBody] = useState("");
  const [newsletter, setNewsletter] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState(guestEmail || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<null | { external_review_url: string | null }>(null);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const res = await fetch("/api/guest/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, token,
          rating: rating || null,
          body: body.trim() || null,
          newsletter_email: newsletter ? (newsletterEmail || guestEmail || "").trim() : null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Couldn't send.");
      setOk({ external_review_url: j.external_review_url || null });
    } catch (e: any) { setErr(e.message || "Something went wrong"); }
    finally { setBusy(false); }
  }

  if (ok) {
    return (
      <div className="mt-10">
        <div className="rounded-lg px-5 py-6" style={{ background: brand.accent + "10", border: `1px solid ${brand.accent}55` }}>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ color: brand.accent }}>Received</p>
          <h2 className={`mt-2 text-[24px] ${brand.displayClass}`} style={{ color: brand.ink }}>Thank you.</h2>
          <p className="mt-3 font-serif italic text-[15.5px]" style={{ color: brand.inkSoft }}>
            The team sees this straight away.
          </p>
          {ok.external_review_url ? (
            <div className="mt-6 border-t pt-5" style={{ borderColor: brand.accent + "33" }}>
              <p className="font-serif italic text-[15px]" style={{ color: brand.inkSoft }}>
                Would you share it publicly too? It helps the next guest find us.
              </p>
              <a
                href={ok.external_review_url} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-block rounded-full px-5 py-2 font-sans text-[13px]"
                style={{ background: brand.accent, color: "#FBF7EF" }}
              >Leave a public review</a>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const lbl = "font-mono text-[10.5px] uppercase tracking-[0.24em]";
  const inp = "mt-1 w-full rounded border bg-transparent px-3 py-2.5 font-sans text-[15px] outline-none";
  const inpStyle = { borderColor: brand.accent + "44", color: brand.ink } as React.CSSProperties;

  return (
    <div className="mt-10 space-y-6">
      <div>
        <span className={lbl} style={{ color: brand.clay }}>Overall</span>
        <div className="mt-3 flex gap-1.5">
          {[1,2,3,4,5].map((n) => (
            <button
              type="button" key={n}
              onClick={() => setRating(n)}
              aria-label={`${n} of 5`}
              className="h-11 w-11 rounded-full border font-serif text-[18px]"
              style={{
                borderColor: rating >= n ? brand.accent : brand.accent + "44",
                background: rating >= n ? brand.accent : "transparent",
                color: rating >= n ? "#FBF7EF" : brand.inkSoft,
              }}
            >{n}</button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Tell us more (optional)</span>
        <textarea rows={5} className={inp} style={inpStyle} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What we got right, what we didn't. The team reads every note." />
      </label>

      <label className="flex items-start gap-3 py-2">
        <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-1 h-4 w-4 accent-black" />
        <span className="font-serif italic text-[15px] leading-snug" style={{ color: brand.inkSoft }}>
          Would you like to hear about our next tasting menu?
        </span>
      </label>
      {newsletter ? (
        <label className="block">
          <span className={lbl} style={{ color: brand.clay }}>Email for the mailer</span>
          <input type="email" className={inp} style={inpStyle} value={newsletterEmail} onChange={(e) => setNewsletterEmail(e.target.value)} />
        </label>
      ) : null}

      {err ? <p className="font-serif italic text-[14px]" style={{ color: "#9A3122" }}>{err}</p> : null}

      <button
        type="button" onClick={submit} disabled={busy || (!rating && !body.trim())}
        className="w-full rounded-full py-3 font-sans text-[14px] tracking-wide disabled:opacity-50"
        style={{ background: brand.accent, color: "#FBF7EF" }}
      >
        {busy ? "Sending…" : "Share your visit"}
      </button>
    </div>
  );
}
