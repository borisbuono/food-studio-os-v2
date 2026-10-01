"use client";

// CleaningToday — today's cleaning lists for one house (cleaning S1, 2026-10-02).
//
// Phone first, wet hands: every line is a 64 px button, the whole row is the
// tap target, one tap = done by me now. Undo sits on the row for 10 s after a
// tick (the DB allows untick any time while the run is open — the 10 s is the
// screen's promise, not a lock). Nothing auto-ticks. "Sign off" is the
// responsible person's signature and shows for managers only; the DB checks
// again. Language is passed from the server (fs_lang) so SSR and client agree.
//
// S2 adds temperature lines: tap → number → out-of-range flags red and adds
// a corrective-action line that must carry a note before the run can be signed.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolve, type Lang } from "@/lib/i18nDict";
import type { CleaningRun, CleaningRunItem, CleaningShift } from "@/lib/cleaning/types";
import { SHIFT_ORDER } from "@/lib/cleaning/types";

type Props = { entityId: string; houseSlug: string; serviceDate: string; lang: Lang; isManager: boolean };

const UNDO_MS = 10_000;

function hhmm(iso: string | null | undefined, tz?: string) {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso)); } catch { return ""; }
}

export default function CleaningToday({ entityId, houseSlug, serviceDate, lang, isManager }: Props) {
  const t = useCallback((k: string) => resolve(k, lang), [lang]);
  const [runs, setRuns] = useState<CleaningRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // item id → deadline (ms) while Undo is offered
  const [undoUntil, setUndoUntil] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/cleaning/today?entity=${entityId}&date=${serviceDate}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setRuns(j.runs || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [entityId, serviceDate]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const patchItem = useCallback((item: CleaningRunItem) => {
    setRuns((rs) => rs.map((r) => r.id !== item.run_id ? r : { ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) }));
  }, []);

  const offerUndo = useCallback((id: string) => {
    const until = Date.now() + UNDO_MS;
    setUndoUntil((u) => ({ ...u, [id]: until }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => setUndoUntil((u) => { const n = { ...u }; delete n[id]; return n; }), UNDO_MS);
  }, []);

  const tick = useCallback(async (item: CleaningRunItem, done: boolean) => {
    if (busy.has(item.id)) return;
    setBusy((b) => new Set(b).add(item.id));
    // optimistic
    patchItem({ ...item, done, done_by_name: done ? item.done_by_name || "…" : null, done_at: done ? new Date().toISOString() : null });
    try {
      const r = await fetch("/api/cleaning/tick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: item.id, done }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "tick failed");
      patchItem(j.item);
      if (done) offerUndo(item.id); else { clearTimeout(timers.current[item.id]); setUndoUntil((u) => { const n = { ...u }; delete n[item.id]; return n; }); }
    } catch (e: any) {
      setError(String(e?.message || e));
      reload();
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(item.id); return n; });
    }
  }, [busy, patchItem, offerUndo, reload]);

  const addNote = useCallback(async (item: CleaningRunItem) => {
    const isCorr = item.kind === "corrective";
    const text = window.prompt(isCorr ? t("cleaning.corrective_prompt") : t("cleaning.note_prompt"), item.note || "");
    if (text === null) return;
    try {
      const r = await fetch("/api/cleaning/note", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: item.id, note: text }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "note failed");
      patchItem(j.item);
      // a corrective action with its text is done: tick it in the same breath
      if (isCorr && text.trim() && !item.done) tick({ ...j.item }, true);
    } catch (e: any) { setError(String(e?.message || e)); }
  }, [t, patchItem, tick]);

  const readTemp = useCallback(async (item: CleaningRunItem) => {
    const band = item.target_min_c != null || item.target_max_c != null ? ` (${item.target_min_c ?? "…"}–${item.target_max_c ?? "…"} °C)` : "";
    const raw = window.prompt(`${t("cleaning.temp_prompt")} ${item.equipment_name || item.label}${band}`, item.temperature_c != null ? String(item.temperature_c) : "");
    if (raw === null) return;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return;
    setBusy((b) => new Set(b).add(item.id));
    try {
      const r = await fetch("/api/cleaning/temp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: item.id, temperature_c: n }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "temp failed");
      await reload();
      offerUndo(item.id);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy((b) => { const n2 = new Set(b); n2.delete(item.id); return n2; }); }
  }, [t, reload, offerUndo]);

  const sign = useCallback(async (run: CleaningRun) => {
    const open = run.items.filter((i) => !i.done).length;
    const corr = run.items.some((i) => i.kind === "corrective" && (!i.note || !i.done));
    if (corr) { setError(t("cleaning.corrective_pending")); return; }
    if (open > 0 && !window.confirm(`${open} ${t("cleaning.sign_confirm")}`)) return;
    try {
      const r = await fetch("/api/cleaning/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: run.id }) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "sign failed");
      setRuns((rs) => rs.map((x) => (x.id === run.id ? { ...x, ...j.run, items: x.items } : x)));
    } catch (e: any) { setError(String(e?.message || e)); }
  }, [t]);

  const groups = useMemo(() => {
    const m = new Map<CleaningShift, CleaningRun[]>();
    for (const r of runs) (m.get(r.shift) || m.set(r.shift, []).get(r.shift))!.push(r);
    return SHIFT_ORDER.filter((s) => m.has(s)).map((s) => ({ shift: s, runs: m.get(s)! }));
  }, [runs]);

  const openCount = runs.reduce((n, r) => n + r.items.filter((i) => !i.done).length, 0);
  const total = runs.reduce((n, r) => n + r.items.length, 0);

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 lg:max-w-3xl">
      <div className="flex items-baseline justify-between gap-3 pt-2">
        <p className="font-mono text-[12px] uppercase tracking-wide text-clay">{serviceDate} · {total - openCount}/{total} {t("cleaning.done_of")}</p>
        <div className="flex gap-3 font-mono text-[12px] uppercase tracking-wide">
          <Link href={`/h/${houseSlug}/service/cleaning/register`} className="text-ink underline-offset-4 hover:underline">{t("cleaning.register")}</Link>
          {isManager ? <Link href={`/h/${houseSlug}/service/cleaning?tab=templates`} className="text-ink underline-offset-4 hover:underline">{t("cleaning.templates")}</Link> : null}
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 rounded-xl border border-tomato/40 bg-paper-deep px-3 py-2 text-[14px] text-tomato">{error}</p> : null}
      {loading ? <p className="mt-6 text-clay">…</p> : null}
      {!loading && !runs.length ? <p className="mt-6 text-ink-soft">{t("cleaning.empty")}</p> : null}

      {groups.map((g) => (
        <section key={g.shift} className="mt-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-clay">{t("cleaning.shift." + g.shift)}</h2>
          {g.runs.map((run) => {
            const done = run.items.filter((i) => i.done).length;
            const signed = run.status === "signed";
            const corrPending = run.items.some((i) => i.kind === "corrective" && (!i.note || !i.done));
            return (
              <article key={run.id} className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
                <header className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2">
                  <div>
                    <h3 className="font-serif text-[20px] leading-tight text-ink">{run.template_name}</h3>
                    {run.area ? <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{run.area}</p> : null}
                  </div>
                  <p className="shrink-0 font-mono text-[13px] tabular-nums text-ink-soft">{done}/{run.items.length}</p>
                </header>
                <ul className="divide-y divide-line-soft border-t border-line-soft">
                  {run.items.map((it) => {
                    const canUndo = it.done && (undoUntil[it.id] || 0) > Date.now();
                    const isTemp = it.kind === "temp";
                    const isCorr = it.kind === "corrective";
                    const out = isTemp && it.in_range === false;
                    const onTap = () => {
                      if (signed) return;
                      if (isTemp) return readTemp(it);
                      if (isCorr && !it.done) return addNote(it);
                      tick(it, !it.done);
                    };
                    return (
                      <li key={it.id} className={isCorr ? "bg-paper-deep" : ""}>
                        <div className="flex items-stretch">
                          <button
                            type="button"
                            onClick={onTap}
                            disabled={signed || busy.has(it.id)}
                            aria-pressed={it.done}
                            className="flex min-h-[64px] flex-1 items-center gap-4 px-4 py-3 text-left active:bg-paper-deep disabled:opacity-70"
                          >
                            <span aria-hidden className={"grid h-11 w-11 shrink-0 place-items-center rounded-lg border-2 " + (out ? "border-tomato text-tomato" : it.done ? "border-ink bg-ink text-paper" : "border-ink-soft")}>
                              {isTemp && it.temperature_c != null ? <span className="font-mono text-[13px] tabular-nums">{it.temperature_c}°</span> : it.done ? "✓" : isTemp ? "°C" : ""}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={"block text-[17px] leading-snug " + (it.done && !out ? "text-ink-soft" : out ? "text-tomato" : "text-ink")}>
                                {isCorr ? `${t("cleaning.corrective")} — ` : ""}{it.label}
                              </span>
                              {it.done && it.done_by_name ? (
                                <span className="block font-mono text-[11px] text-clay">{t("cleaning.by")} {it.done_by_name} · {hhmm(it.done_at)}{out ? ` · ${t("cleaning.temp_out")}` : ""}</span>
                              ) : null}
                              {it.note ? <span className="block text-[13px] italic text-ink-soft">“{it.note}”</span> : null}
                            </span>
                          </button>
                          {!signed ? (
                            canUndo ? (
                              <button type="button" onClick={() => tick(it, false)} className="shrink-0 border-l border-line-soft px-4 font-mono text-[12px] uppercase tracking-wide text-ink">{t("cleaning.undo")}</button>
                            ) : (
                              <button type="button" onClick={() => addNote(it)} aria-label={t("cleaning.note")} className="shrink-0 border-l border-line-soft px-4 font-mono text-[12px] uppercase tracking-wide text-clay">✎</button>
                            )
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
                  {signed ? (
                    <p className="font-mono text-[12px] uppercase tracking-wide text-ink">{t("cleaning.signed")} · {run.signed_by_name} · {hhmm(run.signed_at)}</p>
                  ) : isManager ? (
                    <>
                      <p className="font-mono text-[11px] text-clay">{corrPending ? t("cleaning.corrective_pending") : ""}</p>
                      <button type="button" onClick={() => sign(run)} disabled={corrPending} className="min-h-[48px] rounded-xl bg-ink px-5 font-mono text-[13px] uppercase tracking-wide text-paper disabled:opacity-40">{t("cleaning.sign")}</button>
                    </>
                  ) : (
                    <p className="font-mono text-[11px] text-clay">{t("cleaning.sign_managers")}</p>
                  )}
                </footer>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
