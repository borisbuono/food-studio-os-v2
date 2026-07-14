"use client";
import { useState } from "react";

// Client checklist for the Ads reactivation surface. Each row writes back to
// platform_reactivation_state via /api/grow/reach/ads/reactivation. Notes are
// saved on blur so Boris can jot context without an explicit save button.

type Row = {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  done_at: string | null;
  notes: string;
};

export default function AdsReactivationChecklist({
  entity, initial,
}: { entity: "IFL" | "BM"; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  const patch = async (key: string, patch: Partial<Row>) => {
    setBusyKey(key); setErr("");
    setRows((rs) => rs.map((r) => r.key === key ? { ...r, ...patch } : r));
    try {
      const resp = await fetch("/api/grow/reach/ads/reactivation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, platform: "meta-ads", step_key: key, ...patch }),
      });
      const j = await resp.json();
      if (!resp.ok || !j?.ok) throw new Error(j?.error || `save failed (${resp.status})`);
      if (typeof j.done_at !== "undefined") {
        setRows((rs) => rs.map((r) => r.key === key ? { ...r, done_at: j.done_at } : r));
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="mt-4">
      {err ? <p className="mb-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 py-3">
            <button
              onClick={() => patch(r.key, { done: !r.done })}
              disabled={busyKey === r.key}
              aria-pressed={r.done}
              className={`mt-0.5 h-4 w-4 shrink-0 rounded border ${r.done ? "border-basil bg-basil" : "border-ink hover:border-ink"}`}
              title={r.done ? "Mark not done" : "Mark done"}
            />
            <div className="min-w-0 flex-1">
              <p className={`font-serif text-[14px] ${r.done ? "text-ink-soft line-through" : "text-ink"}`}>{r.label}</p>
              <p className="mt-0.5 font-sans text-[12px] text-ink-soft">{r.hint}</p>
              <input
                type="text"
                placeholder="notes (optional)"
                defaultValue={r.notes}
                onBlur={(e) => {
                  const v = e.currentTarget.value;
                  if (v !== r.notes) patch(r.key, { notes: v });
                }}
                className="mt-2 w-full rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink"
              />
            </div>
            <p className="w-24 shrink-0 text-right font-mono text-[9px] uppercase tracking-wide text-muted">
              {r.done && r.done_at ? new Date(r.done_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
