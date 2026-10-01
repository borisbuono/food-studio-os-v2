"use client";
import { useCallback, useEffect, useState } from "react";

// "Suggest cheaper rota" — rota S3 → S8 (Boris's ruling C, 2026-10-01): the
// proposal says WHERE. Per service (lunch / dinner) and area: hours to take out
// (remove a shift, shorten one that spans both services) and hours to add
// (extend a shift from the other service, or add hours nobody is planned for),
// each with its € delta and the reason (forecast covers vs the staffing band).
// The manager accepts each LINE on its own; an "add" line asks them to pick
// who works it. Never auto-applied.

type Item = { line_id: string; action: "remove" | "shorten" | "extend" | "add"; service: "lunch" | "dinner"; service_date: string; area: string;
  shift_id?: string; person_id?: string; name?: string | null; start?: string; end?: string; new_start?: string; new_end?: string;
  minutes: number; eur_delta: number; rate_basis?: string; reason: string; covers: number; need: number; have: number; status: "proposed" | "accepted" | "declined" };
type Warn = { service_date: string; service?: string; area: string; have: number; need: number; covers: number };
type Person = { id: string; name: string | null; role: string | null; rate: number | null };
type Forecast = { service_date: string; booked_covers: number; avg_covers_4w: number; forecast_covers: number; forecast_revenue: number; basis: string;
  last_year_covers: number | null; last_year_source: string | null; holiday: string | null; holiday_kind: string | null; uplift: number; lunch_covers: number; dinner_covers: number; inputs: Record<string, any> };
type Proposal = { id: string; before_eur: number; after_eur: number; items: Item[]; warnings: Warn[]; explanation: string | null; status: string; created_at: string };

const dayOf = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

export default function RotaProposal({ entityId, weekStart, currency = "EUR", people = [], onChanged, onClose }: { entityId: string; weekStart: string; currency?: string; people?: Person[]; onChanged: () => void; onClose: () => void }) {
  const [adding, setAdding] = useState<string | null>(null);     // line_id of the add line being staffed
  const [addPerson, setAddPerson] = useState<string>("");
  const [p, setP] = useState<Proposal | null>(null);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const money = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  const load = useCallback(async () => {
    const r = await fetch(`/api/rota/propose?entity=${entityId}&week=${weekStart}`, { cache: "no-store" });
    const j = await r.json();
    if (j.ok) { setP(j.proposal); setForecast(j.forecast || []); }
  }, [entityId, weekStart]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body: any, key: string) => {
    setBusy(key); setErr(null);
    try {
      const r = await fetch("/api/rota/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity_id: entityId, week_start: weekStart, ...body }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setP(j.proposal);
      if (body.action !== "create") onChanged();
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(null); }
  }, [entityId, weekStart, load, onChanged]);

  const open = p?.items.filter((i) => i.status === "proposed") || [];
  const net = p ? Number(p.after_eur) - Number(p.before_eur) : 0;
  const outEur = open.filter((i) => Number(i.eur_delta) < 0).reduce((n, i) => n + Number(i.eur_delta), 0);
  const inEur = open.filter((i) => Number(i.eur_delta) > 0).reduce((n, i) => n + Number(i.eur_delta), 0);
  // group open lines by day + service, in week order
  const groups: Array<{ key: string; date: string; service: string; items: Item[] }> = [];
  for (const it of open) {
    const key = it.service_date + "|" + it.service;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, date: it.service_date, service: it.service, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || (a.service === "lunch" ? -1 : 1));
  const money2 = (n: number) => (n > 0 ? "+" : "−") + money(Math.abs(n));
  const verb = (it: Item) => it.action === "remove" ? `take ${it.name || "a shift"} off` : it.action === "shorten" ? `shorten ${it.name || "—"} to ${it.new_start}–${it.new_end}` : it.action === "extend" ? `extend ${it.name || "—"} to ${it.new_start}–${it.new_end}` : `add 1 ${it.area.toUpperCase()} ${it.start}–${it.end}`;

  // accept an "add" line: the manager picks the person; the shift is created as a draft, then the line is marked accepted
  const acceptAdd = async (it: Item) => {
    if (!addPerson) return;
    setBusy(it.line_id); setErr(null);
    try {
      const r = await fetch("/api/rota/shift", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upsert", entity_id: entityId, person_id: addPerson, service_date: it.service_date, start_time: it.start, end_time: it.end, area: it.area, role: people.find((x) => x.id === addPerson)?.role || null, notes: "from proposal: " + it.reason }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "could not add the shift");
      await post({ action: "accept", proposal_id: p!.id, line_id: it.line_id, new_shift_id: j.shift.id }, it.line_id);
      setAdding(null); setAddPerson("");
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(null); }
  };

  return (
    <section className="mt-4 rounded-2xl border border-ink/30 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Suggest cheaper rota · same service</p>
        <button onClick={onClose} className="font-mono text-[11px] uppercase text-clay">close</button>
      </div>
      {/* forecast row — S7: tap a day to see what the number is made of */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {forecast.map((f) => (
          <button key={f.service_date} onClick={() => setOpenDay(openDay === f.service_date ? null : f.service_date)}
            className={"rounded-md border px-1 py-1.5 text-center " + (openDay === f.service_date ? "border-ink bg-white" : f.holiday ? "border-ochre/60 bg-ochre/5" : "border-line bg-paper")}>
            <p className="font-mono text-[9px] uppercase text-clay">{dayOf(f.service_date)}</p>
            <p className="font-serif text-[15px] text-ink">{f.forecast_covers}</p>
            <p className="font-mono text-[8px] text-clay truncate">{f.holiday ? "holiday" : f.basis}</p>
          </button>
        ))}
      </div>
      {openDay ? (() => {
        const f = forecast.find((x) => x.service_date === openDay); if (!f) return null; const i = f.inputs || {};
        return (
          <div className="mt-2 rounded-md border border-line bg-white px-3 py-2 font-sans text-[12px] text-ink-soft">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{new Date(f.service_date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · {f.forecast_covers} covers · lunch {f.lunch_covers} · dinner {f.dinner_covers}</p>
            <ul className="mt-1 space-y-0.5">
              <li>On the book: <b>{f.booked_covers}</b>{i.walkin_ratio ? ` × walk-in ${i.walkin_ratio} → ${i.booked_projection}` : ""}</li>
              <li>Same weekday, last {i.n_8w || 0} weeks: <b>{i.history ?? "—"}</b>{i.n_4w ? ` (last 4: ${i.avg_4w})` : ""}</li>
              <li>Last year {f.last_year_source ? `(${f.last_year_source})` : ""}: <b>{f.last_year_covers ?? "no data"}</b></li>
              <li>{f.holiday ? <>Holiday: <b>{f.holiday}</b> · ×{f.uplift} ({i.uplift_source})</> : "No holiday"}</li>
              <li className="text-clay">Basis: {f.basis}{i.spend_per_cover ? ` · covers without a guest count = revenue ÷ €${i.spend_per_cover}` : ""}</li>
            </ul>
          </div>
        );
      })() : null}
      <p className="mt-1 font-mono text-[10px] text-clay">covers forecast · bookings × walk-in vs. history (60 %) + last year (40 %) × holiday uplift — tap a day</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={!!busy} onClick={() => post({ action: "create", lang: typeof navigator !== "undefined" && navigator.language.startsWith("es") ? "es" : "en" }, "create")} className="rounded-md bg-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">{busy === "create" ? "…" : p ? "Recalculate" : "Suggest"}</button>
        {p ? <span className="font-mono text-[12px] text-ink">{money(Number(p.before_eur))} → <span className={net < 0 ? "text-basil" : net > 0 ? "text-tomato" : ""}>{money(Number(p.after_eur))}</span>{open.length ? <span className="text-clay"> · out {money(Math.abs(outEur))} · in {money(inEur)}</span> : null}</span> : null}
      </div>
      {err ? <p className="mt-2 text-[12px] text-tomato">{err}</p> : null}
      {p?.explanation ? <p className="mt-3 font-sans text-[14px] text-ink-soft">{p.explanation}</p> : null}

      {p && open.length ? (
        <ul className="mt-3 space-y-2">
          {groups.map((g) => (
            <li key={g.key} className="rounded-md border border-line bg-white px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{dayOf(g.date)} · {g.service} · {g.items[0].covers} covers forecast</p>
              <ul className="mt-1 divide-y divide-line">
                {g.items.map((it) => (
                  <li key={it.line_id} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-serif text-[15px] text-ink">
                          <span className={it.eur_delta < 0 ? "text-basil" : "text-tomato"}>{money2(Number(it.eur_delta))}</span> · {verb(it)}
                          <span className="ml-2 font-mono text-[11px] text-ink-soft">{it.action === "add" ? "" : it.start + "–" + it.end + " · "}{it.area.toUpperCase()} · {Math.abs(it.minutes) >= 60 ? (Math.abs(it.minutes) / 60).toFixed(Math.abs(it.minutes) % 60 ? 1 : 0) + " h" : Math.abs(it.minutes) + " min"}</span>
                        </p>
                        <p className="font-sans text-[12px] text-clay">{it.reason}{it.rate_basis ? " · " + it.rate_basis : ""}</p>
                      </div>
                      {adding === it.line_id ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <select value={addPerson} onChange={(e) => setAddPerson(e.target.value)} className="rounded-md border border-line bg-white px-2 py-2 font-sans text-[13px] text-ink">
                            <option value="">who works it?</option>
                            {people.map((x) => <option key={x.id} value={x.id}>{x.name || "—"}{x.rate == null ? " (no rate)" : ""}</option>)}
                          </select>
                          <button disabled={!!busy || !addPerson} onClick={() => acceptAdd(it)} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase text-white disabled:opacity-50">{busy === it.line_id ? "…" : "Add shift"}</button>
                          <button onClick={() => { setAdding(null); setAddPerson(""); }} className="px-1 font-mono text-[11px] uppercase text-clay">×</button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          {it.action === "add"
                            ? <button disabled={!!busy} onClick={() => { setAdding(it.line_id); setAddPerson(""); }} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase text-white disabled:opacity-50">Accept · pick who</button>
                            : <button disabled={!!busy} onClick={() => post({ action: "accept", proposal_id: p.id, line_id: it.line_id }, it.line_id)} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase text-white disabled:opacity-50">{busy === it.line_id ? "…" : "Accept"}</button>}
                          <button disabled={!!busy} onClick={() => post({ action: "decline", proposal_id: p.id, line_id: it.line_id }, it.line_id)} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase text-ink hover:bg-black/5 disabled:opacity-50">Keep</button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : p ? <p className="mt-3 font-sans text-[13px] text-clay">{p.items.length ? "All lines decided." : "Nothing to move — the plan matches the forecast, service by service."}</p> : null}

      {p && p.warnings.length ? (
        <div className="mt-3 rounded-md border border-ochre/40 bg-ochre/5 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-ochre">Services short of the band ({p.warnings.length}) — the add/extend lines above cover them; nothing is added without you</p>
          <ul className="mt-1 font-sans text-[12px] text-ink-soft">
            {p.warnings.slice(0, 8).map((w, i) => <li key={i}>{dayOf(w.service_date)} {w.service || ""} · {w.area.toUpperCase()} {w.have} planned, {w.need} needed for {w.covers} covers</li>)}
            {p.warnings.length > 8 ? <li className="text-clay">… and {p.warnings.length - 8} more</li> : null}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 font-mono text-[10px] text-clay">Lunch = shifts starting before 16:00 · dinner = from 16:00 or running past 18:30. Bands, rates and uplifts: Team › Rota › Settings.</p>
    </section>
  );
}
