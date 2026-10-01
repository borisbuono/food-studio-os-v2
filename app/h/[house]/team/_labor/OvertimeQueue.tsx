"use client";
import { useCallback, useEffect, useState } from "react";

// The Overtime queue — Labour tab (rota S2, Boris's ruling 3, 2026-10-01).
//
// One row per exception: minutes outside the agreed shift (beyond the entity's
// tolerance), a no-show, or an unplanned clock pair. Approve / Reject / Adjust,
// one tap each. Approved overtime is paid at the overtime rate; approved
// undertime is deducted; rejected = the agreed shift stands. Until the tick,
// the agreed shift is what is paid — never the clock.

type Row = {
  id: string; person_id: string | null; service_date: string; kind: "planned" | "unplanned" | "no_show";
  planned_minutes: number; worked_minutes: number; clock_in: string | null; clock_out: string | null; hourly_cost: number | null; overtime_rate: number;
  early_minutes: number; late_end_minutes: number; late_start_minutes: number; early_end_minutes: number;
  overtime_minutes: number; undertime_minutes: number; overtime_status: string; overtime_approved_minutes: number;
  undertime_status: string; undertime_approved_minutes: number; paid_minutes: number; paid_eur: number | null; overtime_eur: number; decided_at: string | null; note: string | null;
};
type Payload = { ok: boolean; can_write: boolean; pending: Row[]; week: Row[]; names: Record<string, string>; labour: { planned_eur: number; settled_eur: number; overtime_eur: number; pending: number; labour_eur: number; revenue_eur: number; labour_pct: number | null } | null };

const mins = (m: number) => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + "m");
const hhmm = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—");
const dayOf = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default function OvertimeQueue({ entityId, tz, currency = "EUR" }: { entityId: string; tz: string; currency?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{ id: string; kind: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const money = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 2 }).format(n));

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/rota/settlements?entity=${entityId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, [entityId]);
  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id: string, kind: string, decision: string, minutes?: number) => {
    setBusy(id + kind); setErr(null);
    try {
      const r = await fetch("/api/rota/settlements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind, decision, minutes }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setAdjust(null);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [load]);

  const pending = data?.pending || [];
  const canWrite = Boolean(data?.can_write);
  const l = data?.labour;

  return (
    <section className="mt-6">
      {/* this week's labour as PAY (agreed + approved), not as clock */}
      {l ? (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-2xl border border-line bg-card px-4 py-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Labour this week</p>
            <p className="font-serif text-2xl text-ink">{money(l.labour_eur)}<span className="ml-2 font-mono text-[11px] text-clay">{l.labour_pct != null ? l.labour_pct + " % of revenue" : "no revenue yet"}</span></p></div>
          <p className="font-mono text-[11px] text-ink-soft">settled {money(l.settled_eur)} · still planned {money(l.planned_eur)} · overtime paid {money(l.overtime_eur)}</p>
        </div>
      ) : null}

      <div className="mt-6 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Overtime queue — <span className="tabular-nums">{pending.length}</span></h2>
        <span className="font-mono text-[10px] text-clay">pay = agreed shift · this is the only place minutes beyond it are paid</span>
      </div>
      {err ? <p className="mt-2 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{err}</p> : null}
      {!data ? <p className="mt-2 text-sm text-clay">…</p> : pending.length === 0 ? (
        <p className="mt-2 text-sm text-clay">Nothing waiting. Exceptions appear here at clock-out and after the nightly settle.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pending.map((r) => {
            const name = (r.person_id && data?.names[r.person_id]) || "—";
            const items: Array<{ kind: "overtime" | "undertime"; minutes: number; label: string; eur: number | null }> = [];
            if (r.overtime_status === "pending") {
              const why = "unplanned clock-in, no agreed shift";
              items.push({ kind: "overtime", minutes: r.overtime_minutes, eur: r.hourly_cost == null ? null : Math.round((r.overtime_minutes / 60) * r.hourly_cost * r.overtime_rate * 100) / 100,
                label: r.kind === "unplanned" ? why : [r.early_minutes ? "in " + mins(r.early_minutes) + " early" : "", r.late_end_minutes ? "out " + mins(r.late_end_minutes) + " late" : ""].filter(Boolean).join(" · ") });
            }
            if (r.undertime_status === "pending") {
              items.push({ kind: "undertime", minutes: r.undertime_minutes, eur: r.hourly_cost == null ? null : Math.round((r.undertime_minutes / 60) * r.hourly_cost * 100) / 100,
                label: r.kind === "no_show" ? "did not clock in" : [r.late_start_minutes ? "in " + mins(r.late_start_minutes) + " late" : "", r.early_end_minutes ? "out " + mins(r.early_end_minutes) + " early" : ""].filter(Boolean).join(" · ") });
            }
            return (
              <li key={r.id} className="rounded-xl border border-line bg-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div>
                    <span className="font-serif text-[16px] text-ink">{name}</span>
                    <span className="ml-2 font-mono text-[11px] text-clay">{dayOf(r.service_date)}</span>
                  </div>
                  <span className="font-mono text-[11px] text-ink-soft">
                    {r.kind === "no_show" ? "agreed " + mins(r.planned_minutes) + " · no clock" : "agreed " + mins(r.planned_minutes) + " · clocked " + hhmm(r.clock_in, tz) + "–" + hhmm(r.clock_out, tz) + " (" + mins(r.worked_minutes) + ")"}
                  </span>
                </div>
                {items.map((it) => (
                  <div key={it.kind} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                    <div>
                      <span className={"font-mono text-[11px] uppercase tracking-wide " + (it.kind === "overtime" ? "text-ink" : "text-tomato")}>{it.kind === "overtime" ? "Overtime" : "Under-time"} {mins(it.minutes)}</span>
                      <span className="ml-2 font-sans text-[12px] text-clay">{it.label}{it.eur != null ? " · " + (it.kind === "overtime" ? "+" : "−") + money(it.eur) : " · no rate set"}</span>
                    </div>
                    {canWrite ? (
                      adjust && adjust.id === r.id && adjust.kind === it.kind ? (
                        <span className="inline-flex items-center gap-2">
                          <input inputMode="numeric" value={adjust.value} onChange={(e) => setAdjust({ ...adjust, value: e.target.value })} className="w-20 rounded-md border border-line bg-white px-2 py-1.5 font-mono text-[12px]" placeholder="min" />
                          <button disabled={!!busy} onClick={() => decide(r.id, it.kind, "adjust", Number(adjust.value || 0))} className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] uppercase text-white">Pay {adjust.value || 0} min</button>
                          <button onClick={() => setAdjust(null)} className="px-1 font-mono text-[11px] uppercase text-clay">×</button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <button disabled={!!busy} onClick={() => decide(r.id, it.kind, "approve")} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">{it.kind === "overtime" ? "Approve" : "Deduct"}</button>
                          <button disabled={!!busy} onClick={() => decide(r.id, it.kind, "reject")} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-black/5 disabled:opacity-50">{it.kind === "overtime" ? "Reject" : "Pay in full"}</button>
                          <button disabled={!!busy} onClick={() => setAdjust({ id: r.id, kind: it.kind, value: String(it.minutes) })} className="rounded-md border border-dashed border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:bg-black/5 disabled:opacity-50">Adjust</button>
                        </span>
                      )
                    ) : <span className="font-mono text-[10px] text-clay">waiting for a manager</span>}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {/* decided this week */}
      {data && data.week.some((r) => r.decided_at) ? (
        <details className="mt-4">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-clay">Decided this week ({data.week.filter((r) => r.decided_at).length})</summary>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {data.week.filter((r) => r.decided_at).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span>{(r.person_id && data.names[r.person_id]) || "—"} <span className="font-mono text-[11px] text-clay">{dayOf(r.service_date)}</span></span>
                <span className="font-mono text-[11px] text-ink-soft">
                  {r.overtime_status !== "none" ? "OT " + r.overtime_status + (r.overtime_status === "approved" ? " " + mins(r.overtime_approved_minutes) : "") : ""}
                  {r.undertime_status !== "none" ? " UT " + r.undertime_status + (r.undertime_status === "approved" ? " −" + mins(r.undertime_approved_minutes) : "") : ""}
                  {" · paid " + mins(r.paid_minutes) + (r.paid_eur != null ? " · " + money(r.paid_eur) : "")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
