"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RotaShift, RotaPerson, RotaWeekRow, RotaCost, RotaSettings } from "@/lib/rota/server";
import RotaProposal from "./RotaProposal";

// The Rota tab — /h/<slug>/team?tab=rota (rota S1, Boris's rulings 2026-10-01).
//
// One week. Phone: the seven days as a list, one card per shift, thumb-sized
// buttons. Desktop: the days as columns. At the top, live: planned labour cost
// against the week's budget (EUR or % of forecast revenue) — ruling 1.
//
// "Copy last week" is the default action on an empty week. "Publish" is the
// manager's tick: only then do shifts reach the unified calendar and each
// person's /me/today. Nothing here is automatic.

type WeekPayload = {
  ok: boolean; week_start: string; week_end: string; can_write: boolean;
  people: RotaPerson[]; shifts: RotaShift[]; week: RotaWeekRow; cost: RotaCost; settings: RotaSettings; last_week_has_shifts: boolean;
};

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (t: string) => String(t || "").slice(0, 5);
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
const dayLabel = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return DAY[(d.getUTCDay() + 6) % 7] + " " + d.getUTCDate() + " " + d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }); };
const hours = (m: number) => (m / 60).toFixed(m % 60 ? 1 : 0) + " h";

export default function Rota({ entityId, houseSlug, currency = "EUR" }: { entityId: string; houseSlug: string; currency?: string }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const [data, setData] = useState<WeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);     // service_date with the add form open
  const [editing, setEditing] = useState<RotaShift | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [proposing, setProposing] = useState(false);

  const money = useCallback((n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 0 }).format(n), [currency]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/rota/week?entity=${entityId}&week=${weekStart}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [entityId, weekStart]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (url: string, body: any, key: string) => {
    setBusy(key); setErr(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      await load();
      return j;
    } catch (e: any) { setErr(String(e?.message || e)); return null; }
    finally { setBusy(null); }
  }, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, RotaShift[]>();
    for (const s of data?.shifts || []) { const l = m.get(s.service_date) || []; l.push(s); m.set(s.service_date, l); }
    return m;
  }, [data]);
  const personName = (id: string) => data?.people.find((p) => p.id === id)?.name || "—";

  const cost = data?.cost;
  const week = data?.week;
  // S5: a week without its own budget inherits the entity default (Team › Rota › Settings)
  const st = data?.settings;
  const budgetEur = week?.budget_eur ?? (week?.budget_pct != null && week?.forecast_revenue != null ? (Number(week.budget_pct) / 100) * Number(week.forecast_revenue) : null)
    ?? st?.weekly_budget_eur ?? (st?.default_budget_pct != null && week?.forecast_revenue != null ? (Number(st.default_budget_pct) / 100) * Number(week.forecast_revenue) : null);
  const budgetInherited = week?.budget_eur == null && week?.budget_pct == null && budgetEur != null;
  const over = budgetEur != null && cost ? cost.planned_eur - budgetEur : null;
  const pctOfForecast = cost && week?.forecast_revenue ? (cost.planned_eur / Number(week.forecast_revenue)) * 100 : null;
  const planned = (data?.shifts || []).filter((s) => s.status === "planned").length;
  const published = (data?.shifts || []).filter((s) => s.status === "published").length;
  const canWrite = Boolean(data?.can_write);

  return (
    <main className="mx-auto max-w-xl lg:max-w-6xl px-4 sm:px-6 py-4">
      {/* week nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide hover:bg-black/5">‹ prev</button>
        <span className="font-mono text-[12px] text-ink">{dayLabel(weekStart)} – {dayLabel(addDays(weekStart, 6))}</span>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide hover:bg-black/5">next ›</button>
      </div>
      <div className="mt-2 flex justify-end"><a href={`/h/${houseSlug}/team/rota/settings`} className="font-mono text-[11px] uppercase tracking-wide text-clay underline-offset-2 hover:underline">Settings · rates, budget, bands</a></div>

      {/* budget strip — ruling 1 */}
      <section className="mt-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Planned labour</p>
            <p className="font-serif text-3xl text-ink">{cost ? money(cost.planned_eur) : "—"}
              <span className="ml-2 font-mono text-[12px] text-clay">{cost ? hours(cost.planned_minutes) + " · " + cost.shifts + " shifts" : ""}</span></p>
            {cost && cost.unpriced > 0 ? <p className="mt-1 font-sans text-[12px] text-tomato">{cost.unpriced} shift{cost.unpriced === 1 ? "" : "s"} without a pay rate — cost understated. <a href={`/h/${houseSlug}/team/rota/settings`} className="underline">Set rates</a>.</p> : null}
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Budget</p>
            <button onClick={() => canWrite && setBudgetOpen((v) => !v)} className="font-serif text-2xl text-ink">
              {budgetEur != null ? money(budgetEur) : <span className="text-clay">{canWrite ? "set a budget" : "—"}</span>}
            </button>
            {week?.budget_pct != null ? <p className="font-mono text-[11px] text-clay">{week.budget_pct} % of {week.forecast_revenue != null ? money(Number(week.forecast_revenue)) : "forecast"}</p> : null}
            {budgetInherited ? <p className="font-mono text-[11px] text-clay">house default</p> : null}
            {over != null ? <p className={"font-mono text-[12px] " + (over > 0 ? "text-tomato" : "text-ink-soft")}>{over > 0 ? "+" : ""}{money(over)} {over > 0 ? "over" : "under"}</p> : null}
            {pctOfForecast != null ? <p className="font-mono text-[11px] text-clay">{pctOfForecast.toFixed(1)} % of forecast revenue</p> : null}
          </div>
        </div>
        {budgetOpen && canWrite ? <BudgetForm week={week ?? null} entityId={entityId} weekStart={weekStart} busy={busy === "budget"} onSave={async (b) => { await post("/api/rota/week", { entity_id: entityId, week_start: weekStart, action: "budget", ...b }, "budget"); setBudgetOpen(false); }} onClose={() => setBudgetOpen(false)} /> : null}
        {/* actions */}
        {canWrite ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data?.last_week_has_shifts ? (
              <button disabled={!!busy} onClick={() => post("/api/rota/week", { entity_id: entityId, week_start: weekStart, action: "copy_last" }, "copy")}
                className={(data.shifts.length ? "border border-line text-ink hover:bg-black/5" : "bg-ink text-white") + " rounded-md px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide disabled:opacity-50"}>
                {busy === "copy" ? "…" : "Copy last week"}
              </button>
            ) : null}
            {planned > 0 ? (
              confirmPublish ? (
                <span className="inline-flex items-center gap-2 rounded-md border border-ink px-2 py-1">
                  <span className="font-sans text-[12px] text-ink">Publish {planned} shift{planned === 1 ? "" : "s"}? They reach the calendar and each person's Today.</span>
                  <button disabled={!!busy} onClick={async () => { await post("/api/rota/week", { entity_id: entityId, week_start: weekStart, action: "publish" }, "publish"); setConfirmPublish(false); }} className="rounded bg-ink px-3 py-1.5 font-mono text-[11px] uppercase text-white">Yes, publish</button>
                  <button onClick={() => setConfirmPublish(false)} className="px-2 font-mono text-[11px] uppercase text-clay">No</button>
                </span>
              ) : (
                <button disabled={!!busy} onClick={() => setConfirmPublish(true)} className="rounded-md border border-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-ink hover:text-white disabled:opacity-50">
                  Publish {planned} draft{planned === 1 ? "" : "s"}
                </button>
              )
            ) : null}
            {data?.shifts.length ? <button onClick={() => setProposing((v) => !v)} className="rounded-md border border-dashed border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:bg-black/5">Suggest cheaper rota</button> : null}
          </div>
        ) : null}
        {week?.status === "published" && planned === 0 ? <p className="mt-3 font-mono text-[11px] text-clay">Published {week.published_at ? new Date(week.published_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} · {published} shifts live on the calendar</p> : null}
      </section>

      {proposing && canWrite ? <RotaProposal entityId={entityId} weekStart={weekStart} currency={currency} onChanged={load} onClose={() => setProposing(false)} /> : null}

      {err ? <p className="mt-3 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{err}</p> : null}

      {!loading && data && data.shifts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line p-5">
          <p className="font-sans text-[14px] text-ink-soft">Nothing planned this week.{canWrite ? (data.last_week_has_shifts ? " Copy last week, then adjust." : " Add the first shift on a day below.") : ""}</p>
        </div>
      ) : null}

      {/* the week: list on phone, 7 columns on desktop */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-7 lg:gap-2">
        {days.map((d) => {
          const list = (byDay.get(d) || []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
          const dayMin = list.reduce((n, s) => n + s.planned_minutes, 0);
          const dayEur = list.reduce((n, s) => n + (s.planned_minutes * Number(s.hourly_cost || 0)) / 60, 0);
          return (
            <section key={d} className="rounded-xl border border-line bg-card p-3">
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-[11px] uppercase tracking-wide text-ink">{dayLabel(d)}</p>
                <p className="font-mono text-[10px] text-clay">{list.length ? hours(dayMin) + " · " + money(dayEur) : "—"}</p>
              </div>
              <ul className="mt-2 space-y-1.5">
                {list.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => canWrite && setEditing(editing?.id === s.id ? null : s)} className={"w-full rounded-md border px-2.5 py-2 text-left " + (s.status === "published" ? "border-line bg-paper" : "border-dashed border-ink/40 bg-white")}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-serif text-[15px] text-ink">{personName(s.person_id)}</span>
                        <span className="font-mono text-[11px] text-ink-soft">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px] text-clay">
                        <span>{[s.area.toUpperCase(), s.role, s.station].filter(Boolean).join(" · ")}</span>
                        <span>{s.status === "planned" ? "draft" : ""}{s.hourly_cost == null ? " · no rate" : ""}</span>
                      </div>
                    </button>
                    {editing?.id === s.id ? (
                      <ShiftForm key={s.id} people={data!.people} initial={s} date={d} days={days} busy={!!busy}
                        onSave={async (f) => { await post("/api/rota/shift", { action: "upsert", entity_id: entityId, id: s.id, ...f }, "shift"); setEditing(null); }}
                        onMove={async (date) => { await post("/api/rota/shift", { action: "move", entity_id: entityId, id: s.id, service_date: date }, "shift"); setEditing(null); }}
                        onRemove={async () => { await post("/api/rota/shift", { action: s.status === "planned" ? "delete" : "cancel", entity_id: entityId, id: s.id }, "shift"); setEditing(null); }}
                        onClose={() => setEditing(null)} />
                    ) : null}
                  </li>
                ))}
              </ul>
              {canWrite ? (
                adding === d ? (
                  <ShiftForm people={data!.people} date={d} days={days} busy={!!busy} initial={null}
                    onSave={async (f) => { const j = await post("/api/rota/shift", { action: "upsert", entity_id: entityId, ...f }, "shift"); if (j) setAdding(null); }}
                    onClose={() => setAdding(null)} />
                ) : (
                  <button onClick={() => { setAdding(d); setEditing(null); }} className="mt-2 w-full rounded-md border border-dashed border-line py-2 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:bg-black/5">+ shift</button>
                )
              ) : null}
            </section>
          );
        })}
      </div>
      <p className="mt-6 font-sans text-[12px] text-clay">Pay is the agreed shift, not the clock. Clock-in is free; minutes beyond the shift land in the Labour tab's overtime queue for a tick.</p>
    </main>
  );
}

function ShiftForm({ people, initial, date, days, busy, onSave, onMove, onRemove, onClose }: {
  people: RotaPerson[]; initial: RotaShift | null; date: string; days: string[]; busy: boolean;
  onSave: (f: { person_id: string; service_date: string; start_time: string; end_time: string; role: string; area: string }) => Promise<void>;
  onMove?: (date: string) => Promise<void>; onRemove?: () => Promise<void>; onClose: () => void;
}) {
  const [person, setPerson] = useState(initial?.person_id || people[0]?.id || "");
  const [start, setStart] = useState(initial ? hhmm(initial.start_time) : "18:00");
  const [end, setEnd] = useState(initial ? hhmm(initial.end_time) : "23:30");
  const [role, setRole] = useState(initial?.role || people.find((p) => p.id === (initial?.person_id || people[0]?.id))?.role || "");
  const [area, setArea] = useState<string>(initial?.area || "foh");
  const inp = "rounded-md border border-line bg-white px-2 py-2 font-sans text-[14px] text-ink";
  if (!people.length) return <p className="mt-2 font-sans text-[12px] text-clay">No active teammates on this house yet — invite them first.</p>;
  return (
    <div className="mt-2 rounded-md border border-line bg-white p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <select value={person} onChange={(e) => { setPerson(e.target.value); const p = people.find((x) => x.id === e.target.value); if (p?.role && !initial) setRole(p.role); }} className={inp + " col-span-2"}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name || "—"}{p.rate == null ? " (no rate)" : ""}</option>)}
        </select>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inp} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inp} />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="role · chef, waiter" className={inp} />
        <select value={area} onChange={(e) => setArea(e.target.value)} className={inp}>
          <option value="foh">FOH</option><option value="boh">BOH</option><option value="other">Other</option>
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy || !person} onClick={() => onSave({ person_id: person, service_date: date, start_time: start, end_time: end, role, area })} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">{initial ? "Save" : "Add"}</button>
        {initial && onMove ? (
          <select defaultValue="" onChange={(e) => e.target.value && onMove(e.target.value)} className="rounded-md border border-line px-2 py-2 font-mono text-[11px] uppercase text-ink-soft">
            <option value="">Move to…</option>
            {days.filter((d) => d !== date).map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        ) : null}
        {initial && onRemove ? <button disabled={busy} onClick={onRemove} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-tomato hover:bg-tomato/5">{initial.status === "planned" ? "Delete" : "Cancel shift"}</button> : null}
        <button onClick={onClose} className="ml-auto px-2 font-mono text-[11px] uppercase text-clay">Close</button>
      </div>
    </div>
  );
}

function BudgetForm({ week, busy, onSave, onClose }: { week: RotaWeekRow; entityId: string; weekStart: string; busy: boolean; onSave: (b: { budget_eur: string | null; budget_pct: string | null; forecast_revenue: string | null }) => Promise<void>; onClose: () => void }) {
  const [eur, setEur] = useState(week?.budget_eur == null ? "" : String(week.budget_eur));
  const [pct, setPct] = useState(week?.budget_pct == null ? "" : String(week.budget_pct));
  const [rev, setRev] = useState(week?.forecast_revenue == null ? "" : String(week.forecast_revenue));
  const inp = "rounded-md border border-line bg-white px-2 py-2 font-sans text-[14px] text-ink w-full";
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
      <label className="font-mono text-[10px] uppercase text-clay">Budget €<input inputMode="decimal" value={eur} onChange={(e) => setEur(e.target.value)} className={inp} placeholder="e.g. 3200" /></label>
      <label className="font-mono text-[10px] uppercase text-clay">or % of revenue<input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className={inp} placeholder="e.g. 30" /></label>
      <label className="font-mono text-[10px] uppercase text-clay">Forecast revenue €<input inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} className={inp} placeholder="auto from bookings" /></label>
      <div className="col-span-3 flex gap-2">
        <button disabled={busy} onClick={() => onSave({ budget_eur: eur || null, budget_pct: pct || null, forecast_revenue: rev || null })} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">Save budget</button>
        <button onClick={onClose} className="px-2 font-mono text-[11px] uppercase text-clay">Close</button>
      </div>
    </div>
  );
}
