"use client";
import { useState } from "react";
import type { GuestBrand } from "@/lib/guest/brand";
import { ALLERGEN_KEYS, DIETARY_KEYS, allergenLabel, dietaryLabel } from "@/lib/guest/allergens";

type Guest = { id: string; name: string | null; email: string | null; phone: string | null; allergies: string | null; dietary: string | null; birthday: string | null; notes: string | null };

// Parse comma/semicolon/newline-separated legacy free-text into the chip vocab.
function parseChips(s: string | null | undefined, allowed: readonly string[]): string[] {
  if (!s) return [];
  const tokens = s.toLowerCase().split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  return allowed.filter((a) => tokens.some((t) => t === a || t === a.replace(/_/g, " ") || t.includes(a)));
}

export default function PreferencesEditor({ slug, token, guest, hasBooking, brand }: {
  slug: string; token: string; guest: Guest; hasBooking: boolean; brand: GuestBrand;
}) {
  const [allergens, setAllergens] = useState<string[]>(parseChips(guest.allergies, ALLERGEN_KEYS));
  const [dietary, setDietary] = useState<string[]>(parseChips(guest.dietary, DIETARY_KEYS));
  const [preferredTable, setPreferredTable] = useState<string>("");
  const [birthday, setBirthday] = useState<string>(guest.birthday || "");
  const [longTermNotes, setLongTermNotes] = useState<string>(guest.notes || "");
  const [visitNeeds, setVisitNeeds] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setErr(null); setBusy(true);
    try {
      const res = await fetch("/api/guest/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, token,
          allergens, dietary,
          preferred_table_label: preferredTable || null,
          birthday: birthday || null,
          long_term_notes: longTermNotes || null,
          visit_needs: visitNeeds || null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Couldn't save.");
      setOk(true);
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally { setBusy(false); }
  }

  const lbl = "font-mono text-[10.5px] uppercase tracking-[0.24em]";
  const inp = "mt-1 w-full rounded border bg-transparent px-3 py-2.5 font-sans text-[15px] outline-none";
  const inpStyle = { borderColor: brand.accent + "44", color: brand.ink } as React.CSSProperties;

  return (
    <div className="mt-8 space-y-8">
      <section>
        <span className={lbl} style={{ color: brand.clay }}>Allergies</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALLERGEN_KEYS.map((k) => {
            const on = allergens.includes(k);
            return (
              <button type="button" key={k}
                onClick={() => setAllergens((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                className="rounded-full border px-2.5 py-0.5 font-sans text-[12px]"
                style={{ borderColor: on ? brand.accent : brand.accent + "44", background: on ? brand.accent : "transparent", color: on ? "#FBF7EF" : brand.inkSoft }}
              >{allergenLabel(k, "en")}</button>
            );
          })}
        </div>
      </section>

      <section>
        <span className={lbl} style={{ color: brand.clay }}>Dietary</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DIETARY_KEYS.map((k) => {
            const on = dietary.includes(k);
            return (
              <button type="button" key={k}
                onClick={() => setDietary((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                className="rounded-full border px-2.5 py-0.5 font-sans text-[12px]"
                style={{ borderColor: on ? brand.accent : brand.accent + "44", background: on ? brand.accent : "transparent", color: on ? "#FBF7EF" : brand.inkSoft }}
              >{dietaryLabel(k, "en")}</button>
            );
          })}
        </div>
      </section>

      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Preferred seating</span>
        <select className={inp} style={inpStyle} value={preferredTable} onChange={(e) => setPreferredTable(e.target.value)}>
          <option value="">No preference</option>
          <option value="terrace">Terrace</option>
          <option value="indoors">Indoors</option>
          <option value="bar">At the bar</option>
          <option value="quiet_corner">Quiet corner</option>
          <option value="window">By a window</option>
        </select>
      </label>

      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Birthday (optional)</span>
        <input type="date" className={inp} style={inpStyle} value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </label>

      <label className="block">
        <span className={lbl} style={{ color: brand.clay }}>Anything else the team should know?</span>
        <textarea rows={3} className={inp} style={inpStyle} value={longTermNotes} onChange={(e) => setLongTermNotes(e.target.value)} placeholder="I love natural wines · accessible entrance please · we're a party of regulars…" />
      </label>

      {hasBooking ? (
        <label className="block">
          <span className={lbl} style={{ color: brand.clay }}>This visit's needs (optional)</span>
          <textarea rows={3} className={inp} style={inpStyle} value={visitNeeds} onChange={(e) => setVisitNeeds(e.target.value)} placeholder="Birthday cake at the end · we need a highchair · surprise proposal…" />
        </label>
      ) : null}

      {err ? <p className="font-serif italic text-[14px]" style={{ color: "#9A3122" }}>{err}</p> : null}
      {ok ? (
        <div className="rounded-lg px-4 py-3" style={{ background: brand.accent + "18", border: `1px solid ${brand.accent}55` }}>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ color: brand.accent }}>Saved</p>
          <p className="mt-1 font-serif italic text-[15px]" style={{ color: brand.inkSoft }}>The team has your preferences. Looking forward to seeing you.</p>
        </div>
      ) : null}

      <button
        type="button" onClick={save} disabled={busy}
        className="w-full rounded-full py-3 font-sans text-[14px] tracking-wide disabled:opacity-60"
        style={{ background: brand.accent, color: "#FBF7EF" }}
      >
        {busy ? "Saving…" : "Save preferences"}
      </button>
    </div>
  );
}
