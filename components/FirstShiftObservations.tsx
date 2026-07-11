"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// The post-shift debrief. Writes the observation into onboarding_steps for
// first_solo_shift as (done_at = now, notes = the text). Doubles as the
// generator of the "day-1 report" above.

export default function FirstShiftObservations({
  userId,
  entityCode,
  initialNotes,
  initialDone,
}: {
  userId: string;
  entityCode: string;
  initialNotes: string;
  initialDone: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(initialDone);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { data: u } = await supabaseBrowser.auth.getUser();
    await supabaseBrowser.from("onboarding_steps").upsert({
      user_id: userId,
      entity_code: entityCode,
      step_key: "first_solo_shift",
      done_at: new Date().toISOString(),
      notes: notes || null,
      observer_user_id: u.user?.id || null,
    }, { onConflict: "user_id,step_key" });
    setSaved(true);
    setBusy(false);
  }

  return (
    <div>
      <p className="font-sans text-[13px] text-ink-soft">Ask three things and write what you heard: How did it feel? What was hard? What is one question you have?</p>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); if (saved) setSaved(false); }}
        placeholder="Their own words work best."
        rows={5}
        className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 font-sans text-[14px] leading-relaxed text-ink"
      />
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={busy || !notes.trim()} className="rounded-xl px-5 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {busy ? "Saving..." : saved ? "Saved" : "Save debrief"}
        </button>
        {saved ? <span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Day-1 report ready</span> : null}
      </div>
    </div>
  );
}
