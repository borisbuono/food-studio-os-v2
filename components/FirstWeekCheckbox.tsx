"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Interactive checkbox for a single onboarding_steps row. Optimistic UI:
// flip the checkbox → write the row → keep the notes field in sync on blur.
//
// One row per (user_id, step_key) via the DB uniqueness constraint. Upsert
// handles both first-write and toggle-off (done_at = null).

export default function FirstWeekCheckbox({
  userId,
  stepKey,
  entityCode,
  initialDone,
  initialNotes,
  label,
}: {
  userId: string;
  stepKey: string;
  entityCode: string;
  initialDone: boolean;
  initialNotes: string;
  label: string;
}) {
  const [done, setDone] = useState(initialDone);
  const [notes, setNotes] = useState(initialNotes || "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function toggle() {
    setSaving(true);
    const nowIso = done ? null : new Date().toISOString();
    setDone(!done);
    const { data: u } = await supabaseBrowser.auth.getUser();
    await supabaseBrowser.from("onboarding_steps").upsert({
      user_id: userId,
      entity_code: entityCode,
      step_key: stepKey,
      done_at: nowIso,
      observer_user_id: u.user?.id || null,
    }, { onConflict: "user_id,step_key" });
    setSaving(false);
  }

  async function persistNotes() {
    setSaving(true);
    const { data: u } = await supabaseBrowser.auth.getUser();
    await supabaseBrowser.from("onboarding_steps").upsert({
      user_id: userId,
      entity_code: entityCode,
      step_key: stepKey,
      notes: notes || null,
      done_at: done ? (new Date().toISOString()) : null,
      observer_user_id: u.user?.id || null,
    }, { onConflict: "user_id,step_key" });
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <input type="checkbox" checked={done} onChange={toggle} disabled={saving} className="h-4 w-4" />
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 text-left">
          <p className={"font-serif text-[17px] " + (done ? "text-ink-soft line-through" : "text-ink")}>{label}</p>
          {notes ? <p className="mt-0.5 font-sans text-[12px] text-ink-soft">{notes}</p> : null}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{open ? "close" : "notes"}</span>
      </div>
      {open ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={persistNotes}
          placeholder="Notes for the manager (optional)"
          rows={2}
          className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 font-sans text-[13px] text-ink"
        />
      ) : null}
    </div>
  );
}
