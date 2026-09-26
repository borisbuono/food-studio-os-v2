"use client";
import { useState, useTransition } from "react";

type Row = {
  id: string;
  entity: string;
  date: string;
  source: string;
  source_ref: string | null;
  total_gross_eur: number;
  imported_at: string;
  event_action: string | null;
  event_verified: boolean;
  event_error: string | null;
};

// Client-side portion of /administrate/finance/pos-sync. Owns the "sync now" per-row
// button and the last-30-days table. All heavy lifting is server-side (/api/integrations/fresto/sync).
export default function PosSyncClient({ rows }: { rows: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const syncOne = (entity: string, date: string) => {
    setRunning(`${entity}:${date}`);
    setFlash(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/integrations/fresto/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity, date_from: date, date_to: date }),
        });
        const j = await r.json();
        if (!j?.ok) setFlash(`${entity} ${date}: ${j?.error || "failed"}`);
        else setFlash(`${entity} ${date}: pulled ${j.pulled}, existed ${j.skipped}, failed ${j.failed}`);
        // Soft refresh — Next router-refresh would need "use router"; instead just re-render on next nav.
      } catch (e: any) {
        setFlash(`${entity} ${date}: ${e?.message || String(e)}`);
      } finally {
        setRunning(null);
      }
    });
  };

  if (!rows.length) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center">
        <p className="font-serif italic text-[15px] text-ink-soft">No EOD snapshots in the last 30 days.</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted">Set up credentials on the entity setup pages, then run a backfill.</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Last 30 days</p>
        {flash ? <p className="font-mono text-[10px] uppercase tracking-wide text-basil">{flash}</p> : null}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-serif text-[14px]">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wide text-muted">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Venue</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Webhook</th>
              <th className="py-2 pr-4 text-right">Total €</th>
              <th className="py-2 pr-4">Last synced</th>
              <th className="py-2 pr-4">Errors</th>
              <th className="py-2 pr-0"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/50 align-top">
                <td className="py-2 pr-4 font-mono text-[12px] text-ink">{r.date}</td>
                <td className="py-2 pr-4 text-ink">{r.entity}</td>
                <td className="py-2 pr-4">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{r.source}</span>
                  {r.source_ref ? <span className="ml-2 font-mono text-[10px] text-muted">{r.source_ref.slice(0, 42)}</span> : null}
                </td>
                <td className="py-2 pr-4">
                  {r.event_action ? (
                    <span className={`font-mono text-[10px] uppercase tracking-wide ${r.event_verified ? "text-basil" : "text-tomato"}`}>
                      {r.event_action} · {r.event_verified ? "verified" : "unverified"}
                    </span>
                  ) : <span className="font-mono text-[10px] text-muted">—</span>}
                </td>
                <td className="py-2 pr-4 text-right font-mono text-[12px] text-ink">{r.total_gross_eur.toFixed(2)}</td>
                <td className="py-2 pr-4 font-mono text-[10px] text-muted">{new Date(r.imported_at).toLocaleString("en-GB")}</td>
                <td className="py-2 pr-4 font-mono text-[10px] text-tomato">{r.event_error || ""}</td>
                <td className="py-2 pr-0 text-right">
                  <button
                    onClick={() => syncOne(r.entity, r.date)}
                    disabled={pending && running === `${r.entity}:${r.date}`}
                    className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-50"
                  >
                    {running === `${r.entity}:${r.date}` ? "syncing…" : "sync now"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
