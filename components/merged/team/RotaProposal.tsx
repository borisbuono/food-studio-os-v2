"use client";
import { useCallback, useEffect, useState } from "react";

// "Suggest cheaper rota" — rota S3, the reverse of ruling 1 (2026-10-01).
// Forecast covers per day (bookings vs. the last 4 same weekdays) against the
// minimum staffing bands; surplus shifts shown as a diff with before/after
// cost. The manager accepts each change on its own. Never auto-applied.

type Item = { shift_id: string; person_id: string; name: string | null; service_date: string; area: string; start: string; end: string; saving_eur: number; reason: string; status: "proposed" | "accepted" | "declined" };
type Warn = { service_date: string; area: string; have: number; need: number; covers: number };
type Forecast = { service_date: string; booked_covers: number; avg_covers_4w: number; forecast_covers: number; forecast_revenue: number; basis: string };
type Proposal = { id: string; before_eur: number; after_eur: number; items: Item[]; warnings: Warn[]; explanation: string | null; status: string; created_at: string };

const dayOf = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

export default function RotaProposal({ entityId, weekStart, currency = "EUR", onChanged, onClose }: { entityId: string; weekStart: string; currency?: string; onChanged: () => void; onClose: () => void }) {
  const [p, setP] = useState<Proposal | null>(null);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
  const saving = p ? Number(p.before_eur) - Number(p.after_eur) : 0;

  return (
    <section className="mt-4 rounded-2xl border border-ink/30 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Suggest cheaper rota · same service</p>
        <button onClick={onClose} className="font-mono text-[11px] uppercase text-clay">close</button>
      </div>
      {/* forecast row */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {forecast.map((f) => (
          <div key={f.service_date} className="rounded-md border border-line bg-paper px-1 py-1.5 text-center">
            <p className="font-mono text-[9px] uppercase text-clay">{dayOf(f.service_date)}</p>
            <p className="font-serif text-[15px] text-ink">{f.forecast_covers}</p>
            <p className="font-mono text-[8px] text-clay truncate">{f.basis}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 font-mono text-[10px] text-clay">covers forecast · bookings vs. the last 4 same weekdays, whichever is higher</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={!!busy} onClick={() => post({ action: "create", lang: typeof navigator !== "undefined" && navigator.language.startsWith("es") ? "es" : "en" }, "create")} className="rounded-md bg-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-white disabled:opacity-50">{busy === "create" ? "…" : p ? "Recalculate" : "Suggest"}</button>
        {p ? <span className="font-mono text-[12px] text-ink">{money(Number(p.before_eur))} → <span className={saving > 0 ? "text-basil" : ""}>{money(Number(p.after_eur))}</span>{saving > 0 ? " (−" + money(saving) + ")" : ""}</span> : null}
      </div>
      {err ? <p className="mt-2 text-[12px] text-tomato">{err}</p> : null}
      {p?.explanation ? <p className="mt-3 font-sans text-[14px] text-ink-soft">{p.explanation}</p> : null}

      {p && open.length ? (
        <ul className="mt-3 space-y-1.5">
          {open.map((it) => (
            <li key={it.shift_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-ink/40 bg-white px-3 py-2">
              <div>
                <span className="font-serif text-[15px] text-ink line-through decoration-tomato/60">{it.name || "—"}</span>
                <span className="ml-2 font-mono text-[11px] text-ink-soft">{dayOf(it.service_date)} {it.start}–{it.end} · {it.area.toUpperCase()}</span>
                <p className="font-sans text-[12px] text-clay">{it.reason} · saves {money(Number(it.saving_eur))}</p>
              </div>
              <span className="inline-flex gap-1.5">
                <button disabled={!!busy} onClick={() => post({ action: "accept", proposal_id: p.id, shift_id: it.shift_id }, it.shift_id)} className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] uppercase text-white disabled:opacity-50">Accept</button>
                <button disabled={!!busy} onClick={() => post({ action: "decline", proposal_id: p.id, shift_id: it.shift_id }, it.shift_id)} className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase text-ink hover:bg-black/5 disabled:opacity-50">Keep</button>
              </span>
            </li>
          ))}
        </ul>
      ) : p ? <p className="mt-3 font-sans text-[13px] text-clay">{p.items.length ? "All changes decided." : "Nothing to take out — the plan is at the minimum for this forecast."}</p> : null}

      {p && p.warnings.length ? (
        <div className="mt-3 rounded-md border border-ochre/40 bg-ochre/5 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-ochre">Below minimum (your call, not changed)</p>
          <ul className="mt-1 font-sans text-[12px] text-ink-soft">
            {p.warnings.map((w, i) => <li key={i}>{dayOf(w.service_date)} · {w.area.toUpperCase()} {w.have} planned, {w.need} needed for {w.covers} covers</li>)}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 font-mono text-[10px] text-clay">Minimum staffing per cover band, overtime rate and tolerance are entity settings (rota_settings).</p>
    </section>
  );
}
