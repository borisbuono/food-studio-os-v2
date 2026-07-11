"use client";
import { useState } from "react";
import type { GuestBrand } from "@/lib/guest/brand";

export default function PrivateForm({ slug, restaurantId, brand }: { slug: string; restaurantId: string; brand: GuestBrand }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", date: "", party_size: "12", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    setErr(null);
    if (!f.name.trim() || !f.email.trim() || !f.description.trim()) {
      setErr("Name, email and a short description are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/guest/private", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, restaurant_id: restaurantId,
          name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(),
          event_date: f.date || null,
          party_size: f.party_size ? Number(f.party_size) : null,
          description: f.description.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Couldn't send — try again?");
      setOk(true);
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally { setBusy(false); }
  }

  if (ok) {
    return (
      <div className="mt-10 rounded-lg p-8" style={{ background: brand.accent + "10", border: `1px solid ${brand.accent}55` }}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Thank you</p>
        <h2 className={`mt-3 text-[26px] ${brand.displayClass}`} style={{ color: brand.ink }}>We've got your enquiry.</h2>
        <p className="mt-4 font-serif italic text-[16px]" style={{ color: brand.inkSoft }}>
          Someone from the team will be in touch shortly to talk it through.
        </p>
      </div>
    );
  }

  const lbl = "font-mono text-[10.5px] uppercase tracking-[0.24em]";
  const inp = "mt-1 w-full rounded border bg-transparent px-3 py-2.5 font-sans text-[15px] outline-none";
  const inpStyle = { borderColor: brand.accent + "44", color: brand.ink } as React.CSSProperties;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-10 space-y-5">
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>Your name</span>
        <input className={inp} style={inpStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>Email</span>
        <input type="email" className={inp} style={inpStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>Phone (optional)</span>
        <input className={inp} style={inpStyle} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label><span className={lbl} style={{ color: brand.clay }}>Date (approx.)</span>
          <input type="date" className={inp} style={inpStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label><span className={lbl} style={{ color: brand.clay }}>People</span>
          <input inputMode="numeric" className={inp} style={inpStyle} value={f.party_size} onChange={(e) => setF({ ...f, party_size: e.target.value.replace(/\D/g, "") })} />
        </label>
      </div>
      <label className="block"><span className={lbl} style={{ color: brand.clay }}>Tell us about it</span>
        <textarea rows={5} className={inp} style={inpStyle} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Anniversary dinner for eight, wine pairing, corner table if possible…" />
      </label>

      {err ? <p className="font-serif italic text-[14px]" style={{ color: "#9A3122" }}>{err}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full py-3 font-sans text-[14px] tracking-wide disabled:opacity-60"
        style={{ background: brand.accent, color: "#FBF7EF" }}
      >
        {busy ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  );
}
