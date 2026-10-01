"use client";
import { useCallback, useEffect, useState } from "react";

// Shift swaps (rota S6, Boris's ruling A, 2026-10-01).
//
// view="me"      → on /me/today: my upcoming shifts with "Offer this shift",
//                  open shifts from colleagues with "Take it", my pending offers.
// view="manager" → on the Rota and Labour tabs: the queue (claimed swaps
//                  waiting for the tick) in the same shape as the Overtime
//                  queue: Approve / Reject one tap; plus still-open offers.
// Only fn_swap_decide moves a shift. Nothing is automatic.

type Shift = { id: string; entity_id: string; person_id: string; service_date: string; start_time: string; end_time: string; role: string | null; station: string | null; area: string; planned_minutes: number; status: string };
type Swap = { id: string; entity_id: string; shift_id: string; from_person: string; to_person: string | null; status: string; note: string | null; offered_at: string; claimed_at: string | null; decided_at: string | null; decision_note: string | null; shift: Shift | null; from_name: string; to_name: string | null };
type Payload = { ok: boolean; my_person_ids: string[]; manager_of: string[]; entities: Array<{ id: string; name: string; slug: string }>; names: Record<string, string>; mine: Array<Shift & { swap: Swap | null }>; open: Swap[]; my_offers: Swap[]; queue: Swap[]; offered: Swap[]; recent: Swap[] };

const hhmm = (t: string) => String(t || "").slice(0, 5);
const dayOf = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const btn = "rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50";
const ghost = "rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-black/5 disabled:opacity-50";

export default function Swaps({ entityId, view }: { entityId?: string; view: "me" | "manager" }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/rota/swaps${entityId ? `?entity=${entityId}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, [entityId]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body: any, key: string) => {
    setBusy(key); setErr(null);
    try {
      const r = await fetch("/api/rota/swaps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [load]);

  if (!data) return err ? <p className="mt-2 text-[12px] text-tomato">{err}</p> : null;
  const entName = (id: string) => data.entities.length > 1 ? data.entities.find((e) => e.id === id)?.name || "" : "";
  const line = (s: Shift | null) => (s ? `${dayOf(s.service_date)} · ${hhmm(s.start_time)}–${hhmm(s.end_time)} · ${[s.area.toUpperCase(), s.role, s.station].filter(Boolean).join(" · ")}` : "—");

  if (view === "me") {
    const upcoming = data.mine.slice(0, 8);
    if (!upcoming.length && !data.open.length && !data.my_offers.length) return null;
    return (
      <section className="mt-6">
        {err ? <p className="mb-2 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{err}</p> : null}
        {upcoming.length ? (
          <>
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-clay">My shifts</h2>
            <ul className="mt-2 space-y-1.5">
              {upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[14px] text-ink">{line(s)}</p>
                    <p className="font-mono text-[10px] text-clay">{entName(s.entity_id)}{s.swap ? (s.swap.status === "claimed" ? ` · ${s.swap.to_name} will take it — waiting for the manager` : " · offered, nobody has taken it yet") : ""}</p>
                  </div>
                  {s.swap ? <button disabled={!!busy} onClick={() => post({ action: "cancel", swap_id: s.swap!.id }, s.id)} className={ghost}>Withdraw</button>
                    : <button disabled={!!busy} onClick={() => post({ action: "offer", shift_id: s.id }, s.id)} className={ghost}>{busy === s.id ? "…" : "Offer this shift"}</button>}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {data.open.length ? (
          <>
            <h2 className="mt-5 font-mono text-[11px] uppercase tracking-wide text-clay">Open shifts — colleagues asking for cover</h2>
            <ul className="mt-2 space-y-1.5">
              {data.open.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-ink/40 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[14px] text-ink">{line(w.shift)}</p>
                    <p className="font-mono text-[10px] text-clay">{w.from_name}{w.note ? ` · ${w.note}` : ""}{entName(w.entity_id) ? ` · ${entName(w.entity_id)}` : ""}</p>
                  </div>
                  <button disabled={!!busy} onClick={() => post({ action: "claim", swap_id: w.id }, w.id)} className={btn}>{busy === w.id ? "…" : "Take it"}</button>
                </li>
              ))}
            </ul>
            <p className="mt-1 font-mono text-[10px] text-clay">Taking a shift asks the manager; it is yours once they approve.</p>
          </>
        ) : null}
        {data.my_offers.filter((w) => w.to_person && data.my_person_ids.includes(w.to_person)).length ? (
          <>
            <h2 className="mt-5 font-mono text-[11px] uppercase tracking-wide text-clay">Shifts I asked to take</h2>
            <ul className="mt-2 space-y-1.5">
              {data.my_offers.filter((w) => w.to_person && data.my_person_ids.includes(w.to_person)).map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 bg-white px-3 py-2">
                  <div><p className="text-[14px] text-ink">{line(w.shift)}</p><p className="font-mono text-[10px] text-clay">from {w.from_name} · waiting for the manager</p></div>
                  <button disabled={!!busy} onClick={() => post({ action: "unclaim", swap_id: w.id }, w.id)} className={ghost}>Step back</button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    );
  }

  // manager view — the queue, same shape as the Overtime queue
  const canWrite = entityId ? data.manager_of.includes(entityId) : data.manager_of.length > 0;
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Swap queue — <span className="tabular-nums">{data.queue.length}</span></h2>
        <span className="font-mono text-[10px] text-clay">a shift changes hands only here</span>
      </div>
      {err ? <p className="mt-2 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{err}</p> : null}
      {!data.queue.length ? <p className="mt-2 text-sm text-clay">Nothing waiting.{data.offered.length ? ` ${data.offered.length} shift${data.offered.length === 1 ? "" : "s"} offered, nobody has taken ${data.offered.length === 1 ? "it" : "them"} yet.` : ""}</p> : (
        <ul className="mt-3 space-y-2">
          {data.queue.map((w) => (
            <li key={w.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div><span className="font-serif text-[16px] text-ink">{w.from_name}</span><span className="mx-2 font-mono text-[12px] text-clay">→</span><span className="font-serif text-[16px] text-ink">{w.to_name}</span></div>
                <span className="font-mono text-[11px] text-ink-soft">{line(w.shift)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                <span className="font-sans text-[12px] text-clay">{w.note ? `"${w.note}" · ` : ""}offered {new Date(w.offered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, taken {w.claimed_at ? new Date(w.claimed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                {canWrite ? (
                  <span className="inline-flex gap-1.5">
                    <button disabled={!!busy} onClick={() => post({ action: "approve", swap_id: w.id }, w.id)} className={btn}>{busy === w.id ? "…" : "Approve"}</button>
                    <button disabled={!!busy} onClick={() => post({ action: "reject", swap_id: w.id }, w.id)} className={ghost}>Reject</button>
                  </span>
                ) : <span className="font-mono text-[10px] text-clay">waiting for a manager</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.offered.length ? (
        <ul className="mt-3 space-y-1.5">
          {data.offered.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line bg-white px-3 py-2">
              <div><span className="font-serif text-[15px] text-ink">{w.from_name}</span><span className="ml-2 font-mono text-[11px] text-ink-soft">{line(w.shift)}</span><p className="font-sans text-[12px] text-clay">open offer — colleagues see it on their Today{w.note ? ` · "${w.note}"` : ""}</p></div>
              {canWrite ? <button disabled={!!busy} onClick={() => post({ action: "cancel", swap_id: w.id }, w.id)} className={ghost}>Withdraw</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data.recent.length ? (
        <details className="mt-3" onToggle={(e) => setShowRecent((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-clay">Decided (last 14 days · {data.recent.length})</summary>
          {showRecent ? <ul className="mt-2 divide-y divide-line text-[13px]">{data.recent.map((w) => <li key={w.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{w.from_name}{w.to_name ? ` → ${w.to_name}` : ""} <span className="font-mono text-[11px] text-clay">{w.shift ? dayOf(w.shift.service_date) : ""}</span></span><span className="font-mono text-[11px] text-ink-soft">{w.status}{w.decision_note ? ` · ${w.decision_note}` : ""}</span></li>)}</ul> : null}
        </details>
      ) : null}
    </section>
  );
}
