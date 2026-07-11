"use client";
import { useState } from "react";

type State = {
  user_id: string;
  timezone: string;
  whatsapp_triage_hourly: boolean;
  whatsapp_triage_window_start: string;
  whatsapp_triage_window_end: string;
  morning_brief_time: string;
  evening_debrief_time: string;
  daily_academy_time: string;
};

const KNOWN_CRON = [
  { key: "whatsapp_triage_hourly",  label: "WhatsApp triage",   cron: "0 8-22 * * * (hourly, 08→22)" },
  { key: "morning_brief_time",      label: "Morning brief",     cron: "0 9 * * *" },
  { key: "evening_debrief_time",    label: "Evening debrief",   cron: "0 21 * * *" },
  { key: "daily_academy_time",      label: "Daily Academy",     cron: "30 8 * * *" },
];

export default function PAScheduleForm({ initial }: { initial: State }) {
  const [state, setState] = useState<State>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showCron, setShowCron] = useState(false);

  async function save() {
    setSaving(true);
    const r = await fetch("/api/pa/schedule", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    await r.json();
    setSaving(false);
    setSavedAt(new Date());
  }

  return (
    <div className="mt-8">
      {/* WhatsApp triage */}
      <section className="border-t border-line py-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Hourly · during window</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">WhatsApp triage</h2>
            <p className="mt-1 font-serif italic text-[14px] text-ink-soft">The PA scans incoming WhatsApp threads every hour during the day.</p>
          </div>
          <Toggle checked={state.whatsapp_triage_hourly} onChange={(v) => setState({ ...state, whatsapp_triage_hourly: v })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <TimeField label="Start" value={state.whatsapp_triage_window_start} onChange={(v) => setState({ ...state, whatsapp_triage_window_start: v })} />
          <TimeField label="End"   value={state.whatsapp_triage_window_end}   onChange={(v) => setState({ ...state, whatsapp_triage_window_end: v })} />
        </div>
      </section>

      {/* Morning brief */}
      <section className="border-t border-line py-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Once daily</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">Morning brief</h2>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">
          Leads with the highest-impact move + the day's Academy lesson.
        </p>
        <div className="mt-3">
          <TimeField label="Time" value={state.morning_brief_time} onChange={(v) => setState({ ...state, morning_brief_time: v })} />
        </div>
      </section>

      {/* Evening debrief */}
      <section className="border-t border-line py-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Once daily</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">Evening debrief</h2>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">
          Recap, re-queue open todos, surface drift.
        </p>
        <div className="mt-3">
          <TimeField label="Time" value={state.evening_debrief_time} onChange={(v) => setState({ ...state, evening_debrief_time: v })} />
        </div>
      </section>

      {/* Daily academy */}
      <section className="border-t border-line py-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Once daily</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">Daily Academy</h2>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">
          One short lesson every morning at this time.
        </p>
        <div className="mt-3">
          <TimeField label="Time" value={state.daily_academy_time} onChange={(v) => setState({ ...state, daily_academy_time: v })} />
        </div>
      </section>

      {/* Sync with Vercel cron */}
      <section className="border-t border-line py-6">
        <button
          onClick={() => setShowCron((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:text-ink"
        >
          {showCron ? "Hide cron plan" : "Sync with Vercel cron"}
        </button>
        {showCron ? (
          <div className="mt-3 rounded-2xl border border-line bg-paper-deep p-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Active scheduled tasks</p>
            <ul className="mt-2 space-y-2">
              {KNOWN_CRON.map((t) => (
                <li key={t.key} className="flex items-baseline justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <span className="font-serif text-[14px] text-ink">{t.label}</span>
                  <span className="font-mono text-[10px] text-clay">{t.cron}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-serif italic text-[13px] text-ink-soft">
              Vercel cron reads from this table on next deploy. Edit + save above; the runner picks up the new times.
            </p>
          </div>
        ) : null}
      </section>

      {/* Save */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-ink px-5 py-2 font-mono text-[10px] uppercase tracking-wide text-paper transition hover:opacity-80 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
        {savedAt ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
            saved · {savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? "bg-ink" : "bg-line"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-paper transition ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-paper px-3 py-1 font-mono text-[13px] text-ink outline-none focus:border-ink"
      />
    </label>
  );
}
