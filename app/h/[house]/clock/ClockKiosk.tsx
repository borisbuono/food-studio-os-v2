"use client";

import { useEffect, useMemo, useState } from "react";

// Kiosk client — a tap-in / tap-out grid for the whole roster.
// Reads /api/shifts/live every 30s so several devices in a kitchen can
// keep the same picture. Rate-limited to the "on the floor" query — the
// full roster ships as SSR props and doesn't refresh (a manager change
// is rare vs. a clock event).

type Person = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
};

type LiveShift = {
  id: string;
  user_id: string;
  role: string | null;
  station: string | null;
  clock_in: string;
  hourly_rate_eur: number | null;
  name: string | null;
};

type Props = {
  entity_id: string;
  roster: Person[];
  houseName: string;
  houseSlug: string;
};

function elapsedLabel(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin - h * 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function ClockKiosk({ entity_id, roster, houseName, houseSlug }: Props) {
  const [live, setLive] = useState<LiveShift[]>([]);
  const [tick, setTick] = useState<number>(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ shift: LiveShift; person: Person; breakMinutes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the live floor every 30s. useEffect handles both mount and cleanup.
  useEffect(() => {
    let dead = false;
    async function pull() {
      try {
        const res = await fetch(`/api/shifts/live?entity=${entity_id}`, { cache: "no-store" });
        const j = await res.json();
        if (dead) return;
        if (j.ok) setLive(j.shifts || []);
      } catch { /* transient — next tick will retry */ }
    }
    pull();
    const iv = setInterval(pull, 30_000);
    const clock = setInterval(() => setTick(Date.now()), 15_000);
    return () => { dead = true; clearInterval(iv); clearInterval(clock); };
  }, [entity_id]);

  const openByUser = useMemo(() => {
    const m = new Map<string, LiveShift>();
    for (const s of live) m.set(s.user_id, s);
    return m;
  }, [live]);

  async function clockIn(person: Person) {
    setBusy(person.auth_user_id);
    setError(null);
    try {
      const res = await fetch("/api/shifts/clock-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id, user_id: person.auth_user_id, role: person.role || undefined }),
      });
      const j = await res.json();
      if (!j.ok) setError(j.error || "Clock-in failed");
      else {
        // optimistic push into live
        setLive((prev) => [...prev, {
          id: j.shift.id, user_id: person.auth_user_id, role: j.shift.role || null, station: j.shift.station || null,
          clock_in: j.shift.clock_in, hourly_rate_eur: j.shift.hourly_rate_eur ?? null, name: person.name,
        }]);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  }

  async function submitClockOut() {
    if (!confirm) return;
    setBusy(confirm.person.auth_user_id);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/${confirm.shift.id}/clock-out`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ break_minutes: confirm.breakMinutes || 0 }),
      });
      const j = await res.json();
      if (!j.ok) setError(j.error || "Clock-out failed");
      else {
        setLive((prev) => prev.filter((s) => s.id !== confirm.shift.id));
        setConfirm(null);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  }

  const onFloor = live.length;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-black/10 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-clay font-mono">Clock in · {houseName}</div>
          <div className="mt-1 text-lg font-serif">
            <span className="font-semibold">{onFloor}</span> on shift
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <a className="rounded border border-black/15 px-3 py-1.5" href={`/h/${houseSlug}/office/labor`}>Manage</a>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      <main className="px-3 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {roster.length === 0 && (
            <div className="col-span-full rounded border border-dashed border-black/15 p-6 text-sm text-clay">
              No team members yet. Add people at <a className="underline" href={`/h/${houseSlug}/office/labor`}>Manage roster</a>.
            </div>
          )}

          {roster.map((p) => {
            const openShift = openByUser.get(p.auth_user_id);
            const on = !!openShift;
            const elapsed = on && openShift ? elapsedLabel(tick - Date.parse(openShift.clock_in)) : null;
            return (
              <button
                key={p.auth_user_id}
                disabled={busy === p.auth_user_id}
                onClick={() => on ? setConfirm({ shift: openShift!, person: p, breakMinutes: 0 }) : clockIn(p)}
                className={
                  "flex flex-col items-center rounded-lg border p-3 text-center transition " +
                  (on
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-black/15 bg-white hover:bg-black/[.03]")
                }
              >
                <div className={
                  "flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold " +
                  (on ? "bg-emerald-600 text-white" : "bg-black/10 text-ink")
                }>
                  {initials(p.name, p.email)}
                </div>
                <div className="mt-2 text-sm font-medium leading-tight">{p.name || p.email || "—"}</div>
                <div className="mt-0.5 text-[11px] text-clay">{p.role || " "}</div>
                <div className="mt-2 text-xs">
                  {on ? (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white">{elapsed} · tap to clock out</span>
                  ) : (
                    <span className="text-clay">Tap to clock in</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </main>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <div className="text-sm text-clay">Clock out</div>
            <div className="mt-1 text-lg font-semibold">{confirm.person.name || confirm.person.email}</div>
            <div className="mt-1 text-xs text-clay">
              On since {new Date(confirm.shift.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>

            <label className="mt-4 block text-sm">
              Unpaid break (minutes)
              <input
                type="number"
                min={0}
                step={5}
                value={confirm.breakMinutes}
                onChange={(e) => setConfirm({ ...confirm, breakMinutes: Math.max(0, Number(e.target.value || 0)) })}
                className="mt-1 w-full rounded border border-black/15 px-3 py-2 text-base"
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border border-black/15 px-3 py-2 text-sm"
                onClick={() => setConfirm(null)}
                disabled={busy === confirm.person.auth_user_id}
              >
                Cancel
              </button>
              <button
                className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                onClick={submitClockOut}
                disabled={busy === confirm.person.auth_user_id}
              >
                {busy === confirm.person.auth_user_id ? "…" : "Clock out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
