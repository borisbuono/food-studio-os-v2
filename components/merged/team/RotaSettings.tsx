"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RotaPerson } from "@/lib/rota/server";

// Team › Rota › Settings (rota S5, 2026-10-01). One page, thumb-sized.
//
// 1 Pay rates per person   → labor_hourly_rates (person_id), via fn_rota_rate_set
// 2 Week budget            → rota_settings.weekly_budget_eur / default_budget_pct (new weeks inherit)
// 3 Overtime + tolerance   → rota_settings.overtime_rate / tolerance_minutes
// 4 Staffing bands         → rota_settings.staffing_bands (min FOH/BOH per cover band)
// 5 Covers                 → spend_per_cover (estimate covers from revenue when the till has no guest count), lunch share
// 6 Special days           → entity_special_days (busier / closed / quiet), uplift per kind
// Each section saves on its own; nothing is applied until the manager taps Save.

type Settings = { holiday_region: string | null; holiday_local: string | null; overtime_rate: number; tolerance_minutes: number; default_budget_pct: number | null; staffing_bands: Array<{ max_covers: number; foh: number; boh: number }>; weekly_budget_eur: number | null; spend_per_cover: number | null; lunch_share: number; holiday_uplift: Record<string, number> };
type Special = { id: string; date: string; name: string; kind: "special" | "closed" | "quiet"; uplift: number | null; notes: string | null };
type Holiday = { date: string; name: string; kind: string; scope: string };
type Payload = { ok: boolean; can_write: boolean; settings: Settings; people: RotaPerson[]; special_days: Special[]; holidays: Holiday[] };

const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 font-sans text-[15px] text-ink";
const lbl = "block font-mono text-[10px] uppercase tracking-wide text-clay";
const btn = "rounded-md bg-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50";
const ghost = "rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-black/5 disabled:opacity-50";
const dayOf = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function RotaSettings({ entityId, houseSlug, currency = "EUR" }: { entityId: string; houseSlug: string; currency?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const money = useCallback((n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 2 }).format(n), [currency]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/rota/settings?entity=${entityId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, [entityId]);
  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body: any, key: string) => {
    setBusy(key); setErr(null); setSaved(null);
    try {
      const r = await fetch("/api/rota/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity_id: entityId, ...body }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setSaved(key);
      await load();
      return j;
    } catch (e: any) { setErr(String(e?.message || e)); return null; }
    finally { setBusy(null); }
  }, [entityId, load]);

  if (!data) return <main className="mx-auto max-w-xl lg:max-w-4xl px-4 sm:px-6 py-6">{err ? <p className="text-[13px] text-tomato">{err}</p> : <p className="font-mono text-[12px] text-clay">…</p>}</main>;
  const canWrite = data.can_write;
  const s = data.settings;

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-4 sm:px-6 py-4 space-y-4">
      {!canWrite ? <p className="rounded-md border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink-soft">You can read these settings; a manager changes them.</p> : null}
      {err ? <p className="rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">{err}</p> : null}

      <Rates people={data.people} canWrite={canWrite} busy={busy} saved={saved} money={money} onSave={(person_id, rate, role) => post({ action: "rate", person_id, rate, role }, "rate:" + person_id)} />

      <BudgetSection s={s} canWrite={canWrite} busy={busy === "budget"} saved={saved === "budget"} money={money} onSave={(patch) => post({ action: "settings", patch }, "budget")} />

      <OvertimeSection s={s} canWrite={canWrite} busy={busy === "overtime"} saved={saved === "overtime"} onSave={(patch) => post({ action: "settings", patch }, "overtime")} />

      <BandsSection bands={s.staffing_bands} canWrite={canWrite} busy={busy === "bands"} saved={saved === "bands"} onSave={(bands) => post({ action: "settings", patch: { staffing_bands: bands } }, "bands")} />

      <CoversSection s={s} canWrite={canWrite} busy={busy === "covers"} saved={saved === "covers"} onSave={(patch) => post({ action: "settings", patch }, "covers")} />

      <SpecialDays days={data.special_days} holidays={data.holidays} uplift={s.holiday_uplift} region={s.holiday_region} local={s.holiday_local} canWrite={canWrite} busy={busy} saved={saved}
        onScope={(patch) => post({ action: "settings", patch }, "scope")}
        onAdd={(d) => post({ action: "special_add", ...d }, "special")} onDelete={(id) => post({ action: "special_delete", id }, "special:" + id)}
        onUplift={(patch) => post({ action: "settings", patch: { holiday_uplift: patch } }, "uplift")} />

      <p className="font-sans text-[12px] text-clay">Pay is hourly cost only — no social charges. Rates and budgets never leave this account; `shift_settlements` remains the only pay record. <a href={`/h/${houseSlug}/team?tab=rota`} className="underline">Back to the rota</a>.</p>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{title}</p>
      {hint ? <p className="mt-1 font-sans text-[13px] text-ink-soft">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
function SaveRow({ busy, saved, canWrite, onSave, label = "Save" }: { busy: boolean; saved: boolean; canWrite: boolean; onSave: () => void; label?: string }) {
  if (!canWrite) return null;
  return <div className="mt-3 flex items-center gap-3"><button disabled={busy} onClick={onSave} className={btn}>{busy ? "…" : label}</button>{saved ? <span className="font-mono text-[11px] text-basil">saved</span> : null}</div>;
}

// 1 — pay rate per person -----------------------------------------------------
function Rates({ people, canWrite, busy, saved, money, onSave }: { people: RotaPerson[]; canWrite: boolean; busy: string | null; saved: string | null; money: (n: number) => string; onSave: (person_id: string, rate: number, role: string | null) => Promise<any> }) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  const missing = people.filter((p) => p.rate == null).length;
  return (
    <Section title="Pay rate per person" hint={missing ? `${missing} of ${people.length} without a rate — their shifts show "no rate" and the week's cost is understated.` : `${people.length} people, all priced.`}>
      {!people.length ? <p className="font-sans text-[13px] text-clay">No active teammates on this house yet.</p> : (
        <ul className="divide-y divide-line">
          {people.map((p) => {
            const v = edit[p.id] ?? "";
            const key = "rate:" + p.id;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[16px] text-ink truncate">{p.name || "—"}</p>
                  <p className="font-mono text-[10px] text-clay">{p.role || ""}{p.auth_user_id ? "" : " · no login yet"}</p>
                </div>
                <span className={"font-mono text-[13px] " + (p.rate == null ? "text-tomato" : "text-ink")}>{p.rate == null ? "no rate" : money(p.rate) + "/h"}</span>
                {canWrite ? (
                  <span className="inline-flex items-center gap-1.5">
                    <input inputMode="decimal" value={v} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} placeholder={p.rate == null ? "€/h" : String(p.rate)} className="w-20 rounded-md border border-line bg-white px-2 py-2 font-mono text-[13px] text-ink" aria-label={`Rate for ${p.name || "person"}`} />
                    <button disabled={busy === key || !v} onClick={async () => { const n = Number(v.replace(",", ".")); if (!Number.isFinite(n) || n < 0) return; const r = await onSave(p.id, n, p.role); if (r) setEdit({ ...edit, [p.id]: "" }); }} className={btn}>{busy === key ? "…" : saved === key ? "✓" : "Set"}</button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 font-mono text-[10px] text-clay">A new rate applies from today; earlier shifts keep the rate they were planned at. Settled days are never re-priced.</p>
    </Section>
  );
}

// 2 — weekly budget --------------------------------------------------------------
function BudgetSection({ s, canWrite, busy, saved, money, onSave }: { s: Settings; canWrite: boolean; busy: boolean; saved: boolean; money: (n: number) => string; onSave: (patch: any) => Promise<any> }) {
  const [eur, setEur] = useState(s.weekly_budget_eur == null ? "" : String(s.weekly_budget_eur));
  const [pct, setPct] = useState(s.default_budget_pct == null ? "" : String(s.default_budget_pct));
  useEffect(() => { setEur(s.weekly_budget_eur == null ? "" : String(s.weekly_budget_eur)); setPct(s.default_budget_pct == null ? "" : String(s.default_budget_pct)); }, [s.weekly_budget_eur, s.default_budget_pct]);
  return (
    <Section title="Weekly labour budget" hint="New weeks start with this. Either a fixed amount or a share of the forecast revenue; the Rota tab shows planned cost against it live. A week can still override it.">
      <div className="grid grid-cols-2 gap-3">
        <label className={lbl}>Budget per week €<input inputMode="decimal" value={eur} onChange={(e) => setEur(e.target.value)} className={inp + " mt-1"} placeholder="e.g. 3200" disabled={!canWrite} /></label>
        <label className={lbl}>or % of forecast revenue<input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className={inp + " mt-1"} placeholder="e.g. 30" disabled={!canWrite} /></label>
      </div>
      {s.weekly_budget_eur != null ? <p className="mt-2 font-mono text-[11px] text-clay">Current: {money(s.weekly_budget_eur)} / week</p> : s.default_budget_pct != null ? <p className="mt-2 font-mono text-[11px] text-clay">Current: {s.default_budget_pct} % of forecast revenue</p> : <p className="mt-2 font-mono text-[11px] text-tomato">No budget yet — the Rota tab cannot say over or under.</p>}
      <SaveRow busy={busy} saved={saved} canWrite={canWrite} onSave={() => onSave({ weekly_budget_eur: eur.replace(",", ".") || null, default_budget_pct: pct.replace(",", ".") || null })} />
    </Section>
  );
}

// 3 — overtime rate + tolerance ------------------------------------------------
function OvertimeSection({ s, canWrite, busy, saved, onSave }: { s: Settings; canWrite: boolean; busy: boolean; saved: boolean; onSave: (patch: any) => Promise<any> }) {
  const [rate, setRate] = useState(String(s.overtime_rate));
  const [tol, setTol] = useState(String(s.tolerance_minutes));
  useEffect(() => { setRate(String(s.overtime_rate)); setTol(String(s.tolerance_minutes)); }, [s.overtime_rate, s.tolerance_minutes]);
  return (
    <Section title="Overtime and tolerance" hint="Pay is the agreed shift. Minutes beyond it, past the tolerance, go to the overtime queue for a tick; approved overtime is paid at this multiple of the hourly rate.">
      <div className="grid grid-cols-2 gap-3">
        <label className={lbl}>Overtime rate (× hourly)<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={inp + " mt-1"} disabled={!canWrite} /></label>
        <label className={lbl}>Tolerance (minutes)<input inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value)} className={inp + " mt-1"} disabled={!canWrite} /></label>
      </div>
      <p className="mt-2 font-mono text-[11px] text-clay">Applied on all four edges: in early, out late, in late, out early.</p>
      <SaveRow busy={busy} saved={saved} canWrite={canWrite} onSave={() => onSave({ overtime_rate: rate.replace(",", "."), tolerance_minutes: tol })} />
    </Section>
  );
}

// 4 — staffing bands -----------------------------------------------------------
function BandsSection({ bands, canWrite, busy, saved, onSave }: { bands: Settings["staffing_bands"]; canWrite: boolean; busy: boolean; saved: boolean; onSave: (bands: any[]) => Promise<any> }) {
  const [rows, setRows] = useState(bands.map((b) => ({ max_covers: String(b.max_covers), foh: String(b.foh), boh: String(b.boh) })));
  useEffect(() => { setRows(bands.map((b) => ({ max_covers: String(b.max_covers), foh: String(b.foh), boh: String(b.boh) }))); }, [bands]);
  const set = (i: number, k: "max_covers" | "foh" | "boh", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const cell = "w-full rounded-md border border-line bg-white px-2 py-2 font-mono text-[13px] text-ink text-center";
  return (
    <Section title="Minimum staffing per service" hint="How many FOH and BOH heads a service needs for up to N covers. The proposal uses this to say where hours can come out and where they are short.">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
        <span className={lbl}>up to covers</span><span className={lbl}>FOH</span><span className={lbl}>BOH</span><span />
        {rows.map((r, i) => (
          <RowFrag key={i}>
            <input inputMode="numeric" value={r.max_covers} onChange={(e) => set(i, "max_covers", e.target.value)} className={cell} disabled={!canWrite} aria-label="up to covers" />
            <input inputMode="numeric" value={r.foh} onChange={(e) => set(i, "foh", e.target.value)} className={cell} disabled={!canWrite} aria-label="FOH" />
            <input inputMode="numeric" value={r.boh} onChange={(e) => set(i, "boh", e.target.value)} className={cell} disabled={!canWrite} aria-label="BOH" />
            {canWrite ? <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="px-2 font-mono text-[12px] text-clay" aria-label="remove band">×</button> : <span />}
          </RowFrag>
        ))}
      </div>
      {canWrite ? <button onClick={() => setRows([...rows, { max_covers: String((Number(rows[rows.length - 1]?.max_covers) || 0) + 30), foh: "1", boh: "1" }])} className={ghost + " mt-2"}>+ band</button> : null}
      <p className="mt-2 font-mono text-[10px] text-clay">Read as: "up to 30 covers → 1 FOH, 1 BOH; up to 60 → 2 and 2". The last band covers anything bigger.</p>
      <SaveRow busy={busy} saved={saved} canWrite={canWrite} onSave={() => onSave(rows.map((r) => ({ max_covers: Number(r.max_covers), foh: Number(r.foh), boh: Number(r.boh) })))} />
    </Section>
  );
}
function RowFrag({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// 5 — covers from revenue ------------------------------------------------------
function CoversSection({ s, canWrite, busy, saved, onSave }: { s: Settings; canWrite: boolean; busy: boolean; saved: boolean; onSave: (patch: any) => Promise<any> }) {
  const [spc, setSpc] = useState(s.spend_per_cover == null ? "" : String(s.spend_per_cover));
  const [ls, setLs] = useState(String(Math.round(s.lunch_share * 100)));
  useEffect(() => { setSpc(s.spend_per_cover == null ? "" : String(s.spend_per_cover)); setLs(String(Math.round(s.lunch_share * 100))); }, [s.spend_per_cover, s.lunch_share]);
  return (
    <Section title="Covers" hint="The till rarely records guests. When a day has revenue but no guest count, covers are estimated as revenue ÷ this. Leave empty to let the OS learn it from the days that do have a count.">
      <div className="grid grid-cols-2 gap-3">
        <label className={lbl}>Net spend per cover €<input inputMode="decimal" value={spc} onChange={(e) => setSpc(e.target.value)} className={inp + " mt-1"} placeholder="learned" disabled={!canWrite} /></label>
        <label className={lbl}>Lunch share of the day %<input inputMode="numeric" value={ls} onChange={(e) => setLs(e.target.value)} className={inp + " mt-1"} disabled={!canWrite} /></label>
      </div>
      <p className="mt-2 font-mono text-[10px] text-clay">Lunch share is only used when the till has no hourly split for that day.</p>
      <SaveRow busy={busy} saved={saved} canWrite={canWrite} onSave={() => onSave({ spend_per_cover: spc.replace(",", ".") || null, lunch_share: String((Number(ls) || 40) / 100) })} />
    </Section>
  );
}

// 6 — special days + holidays ---------------------------------------------------
function SpecialDays({ days, holidays, uplift, region, local, canWrite, busy, saved, onAdd, onDelete, onUplift, onScope }: {
  days: Special[]; holidays: Holiday[]; uplift: Record<string, number>; region: string | null; local: string | null; canWrite: boolean; busy: string | null; saved: string | null;
  onScope: (patch: { holiday_region: string; holiday_local: string }) => Promise<any>;
  onAdd: (d: { date: string; name: string; kind: string; uplift: string | null }) => Promise<any>; onDelete: (id: string) => Promise<any>; onUplift: (patch: Record<string, number>) => Promise<any>;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("special");
  const [up, setUp] = useState("");
  const [u, setU] = useState({ national: String(uplift.national ?? 1.15), regional: String(uplift.regional ?? 1.15), local: String(uplift.local ?? 1.3), special: String(uplift.special ?? 1.4) });
  useEffect(() => { setU({ national: String(uplift.national ?? 1.15), regional: String(uplift.regional ?? 1.15), local: String(uplift.local ?? 1.3), special: String(uplift.special ?? 1.4) }); }, [uplift]);
  const pct = (x: string) => { const n = Number(x); return Number.isFinite(n) ? (n >= 1 ? "+" : "") + Math.round((n - 1) * 100) + " %" : ""; };
  const upcoming = useMemo(() => holidays.slice(0, 12), [holidays]);
  const [reg, setReg] = useState(region || "");
  const [loc, setLoc] = useState(local || "");
  useEffect(() => { setReg(region || ""); setLoc(local || ""); }, [region, local]);
  return (
    <Section title="Special days" hint="Days your room behaves differently: Sant Joan, closing parties, a private buy-out, a day you are closed. The forecast lifts (or drops) covers on these days; public holidays come from the OS calendar below.">
      <ul className="divide-y divide-line">
        {days.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0"><p className="font-serif text-[15px] text-ink truncate">{d.name}</p><p className="font-mono text-[10px] text-clay">{dayOf(d.date)} · {d.kind}{d.uplift != null ? " · ×" + d.uplift : ""}</p></div>
            {canWrite ? <button disabled={busy === "special:" + d.id} onClick={() => onDelete(d.id)} className="px-2 font-mono text-[11px] uppercase text-clay">remove</button> : null}
          </li>
        ))}
        {!days.length ? <li className="py-2 font-sans text-[13px] text-clay">None yet.</li> : null}
      </ul>
      {canWrite ? (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} aria-label="date" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name · Sant Joan, closing party" className={inp} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inp}><option value="special">busier</option><option value="quiet">quieter</option><option value="closed">closed</option></select>
          <input inputMode="decimal" value={up} onChange={(e) => setUp(e.target.value)} placeholder={"factor · default ×" + (u.special || "1.4")} className={inp} />
          <div className="col-span-2 flex items-center gap-3"><button disabled={busy === "special" || !date || !name} onClick={async () => { const r = await onAdd({ date, name, kind, uplift: up || null }); if (r) { setDate(""); setName(""); setUp(""); } }} className={btn}>{busy === "special" ? "…" : "Add day"}</button>{saved === "special" ? <span className="font-mono text-[11px] text-basil">saved</span> : null}</div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-line pt-3">
        <p className={lbl}>Uplift by kind (× normal covers, until the OS has learned a real ratio)</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {(["national", "regional", "local", "special"] as const).map((k) => (
            <label key={k} className="font-mono text-[10px] uppercase text-clay">{k}<input inputMode="decimal" value={u[k]} onChange={(e) => setU({ ...u, [k]: e.target.value })} className={inp + " mt-1 text-center"} disabled={!canWrite} /><span className="block text-center text-[10px] text-clay">{pct(u[k])}</span></label>
          ))}
        </div>
        <SaveRow busy={busy === "uplift"} saved={saved === "uplift"} canWrite={canWrite} onSave={() => onUplift({ national: Number(u.national), regional: Number(u.regional), local: Number(u.local), special: Number(u.special) })} label="Save uplift" />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className={lbl}>Where this house is (which regional and local holidays apply)</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="region · Illes Balears" className={inp} disabled={!canWrite} aria-label="region" />
          <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="municipality · Eivissa" className={inp} disabled={!canWrite} aria-label="municipality" />
        </div>
        <SaveRow busy={busy === "scope"} saved={saved === "scope"} canWrite={canWrite} onSave={() => onScope({ holiday_region: reg, holiday_local: loc })} label="Save place" />
      </div>
      {upcoming.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className={lbl}>Public holidays the forecast knows (next 12)</p>
          <ul className="mt-1 font-mono text-[11px] text-ink-soft">{upcoming.map((h, i) => <li key={i}>{dayOf(h.date)} · {h.name} <span className="text-clay">· {h.scope}{(h as any).provisional ? " · provisional" : ""}</span></li>)}</ul>
        </div>
      ) : <p className="mt-3 font-mono text-[10px] text-clay">Public holidays appear here once the holiday calendar is loaded for this house.</p>}
    </Section>
  );
}
