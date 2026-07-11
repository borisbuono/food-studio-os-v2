"use client";
import { useState } from "react";
import { OCCASIONS } from "@/lib/guest/booking";
import { ALLERGEN_KEYS, DIETARY_KEYS, allergenLabel, dietaryLabel } from "@/lib/guest/allergens";
import type { GuestBrand } from "@/lib/guest/brand";

type Props = {
  slug: string; restaurantId: string; venueName: string;
  slots: string[]; brand: GuestBrand;
};

export default function BookForm({ slug, restaurantId, venueName, slots, brand }: Props) {
  const [f, setF] = useState({
    party_size: "2",
    service_date: "",
    service_time: "",
    name: "",
    email: "",
    phone: "",
    occasion: "",
    notes: "",
    seating_preference: "",
  });
  const [allergies, setAllergies] = useState<string[]>([]);
  const [dietary, setDietary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<null | { date: string; time: string; email: string }>(null);

  async function submit() {
    setErr(null);
    if (!f.name.trim() || !f.email.trim() || !f.service_date || !f.service_time || !Number(f.party_size)) {
      setErr("Name, email, date, time and party size are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/guest/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          restaurant_id: restaurantId,
          party_size: Number(f.party_size),
          service_date: f.service_date,
          service_time: f.service_time,
          name: f.name.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          occasion: f.occasion || null,
          notes: f.notes.trim() || null,
          seating_preference: f.seating_preference || null,
          allergies, dietary,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Couldn't save the booking. Try again?");
      setOk({ date: f.service_date, time: f.service_time, email: f.email });
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (ok) {
    return (
      <div className="mt-12 rounded-lg p-8" style={{ background: brand.accent + "10", border: `1px solid ${brand.accent}55` }}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Confirmed</p>
        <h2 className={`mt-3 text-[28px] ${brand.displayClass}`} style={{ color: brand.ink }}>
          See you on {formatDate(ok.date)} at {ok.time}
        </h2>
        <p className="mt-4 font-serif italic text-[16px]" style={{ color: brand.inkSoft }}>
          A confirmation is on its way to <strong>{ok.email}</strong>. Check your inbox — the email includes a link where
          you can share allergies, dietary preferences or notes for the visit.
        </p>
        <p className="mt-8 font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: brand.clay }}>{venueName}</p>
      </div>
    );
  }

  const lbl = "font-mono text-[10.5px] uppercase tracking-[0.24em]";
  const inp = "mt-1 w-full rounded border bg-transparent px-3 py-2.5 font-sans text-[15px] outline-none";
  const inpStyle = { borderColor: brand.accent + "44", color: brand.ink } as React.CSSProperties;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-10 space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <label>
          <span className={lbl} style={{ color: brand.clay }}>People</span>
          <select className={inp} style={inpStyle} value={f.party_size} onChange={(e) => setF({ ...f, party_size: e.target.value })}>
            {[1,2,3,4,5,6,7,8,9,10,12,14,16,20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          <span className={lbl} style={{ color: brand.clay }}>Date</span>
          <input type="date" className={inp} style={inpStyle} value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} min={new Date().toISOString().slice(0,10)} />
        </label>
        <label>
          <span className={lbl} style={{ color: brand.clay }}>Time</span>
          <select className={inp} style={inpStyle} value={f.service_time} onChange={(e) => setF({ ...f, service_time: e.target.value })}>
            <option value="">—</option>
            {slots.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Your name</span>
        <input className={inp} style={inpStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Email</span>
        <input type="email" className={inp} style={inpStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Phone (optional)</span>
        <input className={inp} style={inpStyle} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </label>

      <fieldset>
        <span className={lbl} style={{ color: brand.clay }}>Occasion (optional)</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {OCCASIONS.map((o) => {
            const on = f.occasion === o.key;
            return (
              <button
                type="button" key={o.key}
                onClick={() => setF({ ...f, occasion: on ? "" : o.key })}
                className="rounded-full border px-3 py-1 font-sans text-[12px]"
                style={{
                  borderColor: on ? brand.accent : brand.accent + "44",
                  background: on ? brand.accent : "transparent",
                  color: on ? "#FBF7EF" : brand.inkSoft,
                }}
              >{o.label}</button>
            );
          })}
        </div>
      </fieldset>

      <details>
        <summary className="cursor-pointer font-serif italic text-[15px]" style={{ color: brand.accent }}>
          Preferences (optional)
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <span className={lbl} style={{ color: brand.clay }}>Allergies</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ALLERGEN_KEYS.map((k) => {
                const on = allergies.includes(k);
                return (
                  <button type="button" key={k}
                    onClick={() => setAllergies((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                    className="rounded-full border px-2.5 py-0.5 font-sans text-[11.5px]"
                    style={{
                      borderColor: on ? brand.accent : brand.accent + "44",
                      background: on ? brand.accent : "transparent",
                      color: on ? "#FBF7EF" : brand.inkSoft,
                    }}
                  >{allergenLabel(k, "en")}</button>
                );
              })}
            </div>
          </div>
          <div>
            <span className={lbl} style={{ color: brand.clay }}>Dietary</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DIETARY_KEYS.map((k) => {
                const on = dietary.includes(k);
                return (
                  <button type="button" key={k}
                    onClick={() => setDietary((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                    className="rounded-full border px-2.5 py-0.5 font-sans text-[11.5px]"
                    style={{
                      borderColor: on ? brand.accent : brand.accent + "44",
                      background: on ? brand.accent : "transparent",
                      color: on ? "#FBF7EF" : brand.inkSoft,
                    }}
                  >{dietaryLabel(k, "en")}</button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className={lbl} style={{ color: brand.clay }}>Seating</span>
            <select className={inp} style={inpStyle} value={f.seating_preference} onChange={(e) => setF({ ...f, seating_preference: e.target.value })}>
              <option value="">No preference</option>
              <option value="terrace">Terrace</option>
              <option value="indoors">Indoors</option>
              <option value="bar">At the bar</option>
              <option value="quiet">Somewhere quiet</option>
            </select>
          </label>
          <label className="block">
            <span className={lbl} style={{ color: brand.clay }}>Notes</span>
            <textarea rows={3} className={inp} style={inpStyle} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Anything the team should know?" />
          </label>
        </div>
      </details>

      {err ? <p className="font-serif italic text-[14px]" style={{ color: "#9A3122" }}>{err}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full py-3 font-sans text-[14px] tracking-wide disabled:opacity-60"
        style={{ background: brand.accent, color: "#FBF7EF" }}
      >
        {busy ? "Booking…" : "Confirm booking"}
      </button>
    </form>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
