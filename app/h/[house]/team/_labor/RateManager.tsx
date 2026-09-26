"use client";

import { useState } from "react";

type Rate = {
  user_id: string;
  name: string | null;
  role: string | null;
  hourly_rate_eur: number;
  effective_from: string;
};

type Candidate = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
};

type Props = {
  entity_id: string;
  initialRates: Rate[];
  roster: Candidate[];
  canWrite: boolean;
};

export default function RateManager({ entity_id, initialRates, roster, canWrite }: Props) {
  const [rates, setRates] = useState<Rate[]>(initialRates);
  const [pick, setPick] = useState<string>(roster[0]?.auth_user_id || "");
  const [rate, setRate] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!pick) { setErr("Pick a person"); return; }
    const n = Number(rate);
    if (!isFinite(n) || n < 0) { setErr("Rate must be a non-negative number"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id, user_id: pick, hourly_rate_eur: n, role: role || undefined }),
      });
      const j = await res.json();
      if (!j.ok) { setErr(j.error || "Save failed"); return; }
      const person = roster.find((r) => r.auth_user_id === pick);
      setRates((prev) => {
        const withoutOld = prev.filter((r) => r.user_id !== pick);
        return [...withoutOld, {
          user_id: pick,
          name: person?.name || null,
          role: j.rate.role || role || null,
          hourly_rate_eur: Number(j.rate.hourly_rate_eur),
          effective_from: j.rate.effective_from,
        }].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      });
      setRate(""); setRole("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded border border-black/10 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Hourly rates</h2>

      {rates.length ? (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-clay">
            <tr><th className="py-1">Name</th><th>Role</th><th className="text-right">€/hr</th><th>Since</th></tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.user_id} className="border-t border-black/5">
                <td className="py-1.5">{r.name || r.user_id.slice(0, 8)}</td>
                <td>{r.role || "—"}</td>
                <td className="text-right tabular-nums">{r.hourly_rate_eur.toFixed(2)}</td>
                <td>{r.effective_from}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-sm text-clay">No rates set yet.</p>
      )}

      {canWrite ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-black/5 pt-4">
          <label className="text-xs">
            <div className="text-clay">Person</div>
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="mt-1 rounded border border-black/15 px-2 py-1.5"
            >
              {roster.map((p) => (
                <option key={p.auth_user_id} value={p.auth_user_id}>
                  {p.name || p.email || p.auth_user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <div className="text-clay">Role (opt)</div>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="chef · line · waiter"
              className="mt-1 rounded border border-black/15 px-2 py-1.5"
            />
          </label>
          <label className="text-xs">
            <div className="text-clay">€/hr</div>
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="15.00"
              className="mt-1 w-24 rounded border border-black/15 px-2 py-1.5"
            />
          </label>
          <button
            onClick={save}
            disabled={busy}
            className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {busy ? "…" : "Save rate"}
          </button>
          {err && <div className="text-xs text-red-700">{err}</div>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-clay">Only managers can set rates.</p>
      )}
    </section>
  );
}
