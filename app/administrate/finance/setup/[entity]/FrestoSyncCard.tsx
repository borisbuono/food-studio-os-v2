"use client";
import { useState, useTransition } from "react";

// Fresto section on /administrate/finance/setup/[entity]. Reads status pill + exposes:
//   - Sync last 7 days (backfill)
//   - Backfill from date
//   - Webhook URLs to configure in Fresto
//
// Server-derived props come from the enclosing server page; UI kept editorial.
export default function FrestoSyncCard({ entity, status, appOrigin }: {
  entity: "IFL" | "BM" | "BBH";
  status: "connected" | "not-configured" | "oauth-error";
  appOrigin: string;
}) {
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState<string>("");
  const [flash, setFlash] = useState<string | null>(null);

  const runSync = (dateFrom: string, dateTo?: string) => {
    setFlash(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/integrations/fresto/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity, date_from: dateFrom, date_to: dateTo || dateFrom }),
        });
        const j = await r.json();
        if (!j?.ok) setFlash(j?.error || "sync failed");
        else setFlash(`Pulled ${j.pulled}, existed ${j.skipped}, failed ${j.failed} across ${j.days} day(s).`);
      } catch (e: any) {
        setFlash(e?.message || String(e));
      }
    });
  };

  const last7 = () => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 7);
    const to = new Date();
    runSync(d.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  };

  const bookingUrl = `${appOrigin}/api/integrations/fresto/webhook/booking-approved?entity=${entity}`;
  const closingUrl = `${appOrigin}/api/integrations/fresto/webhook/closing-report-submitted?entity=${entity}`;

  const pillClass =
    status === "connected" ? "border-basil/40 bg-basil/10 text-basil" :
    status === "oauth-error" ? "border-tomato/40 bg-tomato/10 text-tomato" :
    "border-line bg-paper-deep text-muted";
  const pillLabel = status === "connected" ? "live api" : status === "oauth-error" ? "oauth error" : "not configured";

  return (
    <section className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Fresto</p>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${pillClass}`}>{pillLabel}</span>
      </div>
      <p className="mt-2 font-serif italic text-[13px] text-muted">
        {status === "connected"
          ? "OAuth credentials found for this entity. Backfill orderlines + Z Reports from Fresto's Data Service. Webhooks land automatically once configured in Fresto."
          : entity === "BBH"
            ? "BBH has no POS today — credentials optional. Env vars FRESTO_CLIENT_ID_BBH / FRESTO_CLIENT_SECRET_BBH are reserved for when a holding-level venue lands."
            : "Set FRESTO_CLIENT_ID_" + entity + " and FRESTO_CLIENT_SECRET_" + entity + " on Vercel. Ask Carl (cl@fresto.io) for the credential pair."}
      </p>

      {status === "connected" ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper p-4">
              <p className="font-serif text-[15px] text-ink">Sync last 7 days</p>
              <p className="mt-1 font-serif italic text-[13px] text-muted">Pulls orderlines + Z Reports for the last week. Idempotent — existing snapshots are left as-is.</p>
              <button onClick={last7} disabled={pending}
                className="mt-3 rounded-full border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper hover:opacity-90 disabled:opacity-50">
                {pending ? "syncing…" : "sync 7 days"}
              </button>
            </div>
            <div className="rounded-xl border border-line bg-paper p-4">
              <p className="font-serif text-[15px] text-ink">Backfill from date</p>
              <p className="mt-1 font-serif italic text-[13px] text-muted">Bigger catchup — capped at 200 days per run to be gentle on the API.</p>
              <div className="mt-3 flex items-center gap-2">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink" />
                <button onClick={() => from && runSync(from)} disabled={!from || pending}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-50">
                  backfill
                </button>
              </div>
            </div>
          </div>
          {flash ? <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-basil">{flash}</p> : null}
        </>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Webhook URLs — configure in Fresto</p>
        <p className="mt-1 font-serif italic text-[13px] text-muted">Ask Carl to point Fresto's webhooks at these URLs. Signature: HMAC-SHA256 over the raw body, header <code className="font-mono text-[12px] text-clay">X-Fresto-Signature</code>, using <code className="font-mono text-[12px] text-clay">FRESTO_WEBHOOK_SECRET</code>.</p>
        <div className="mt-3 space-y-2 font-mono text-[11px] text-ink">
          <CopyableUrl label="booking.approved" url={bookingUrl} />
          <CopyableUrl label="closing-report" url={closingUrl} />
        </div>
      </div>
    </section>
  );
}

function CopyableUrl({ label, url }: { label: string; url: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {}
  };
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-[130px] font-mono text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <code className="flex-1 truncate rounded bg-paper-deep px-2 py-1 text-ink">{url}</code>
      <button onClick={copy} className="rounded-full border border-line bg-paper px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-ink-soft">copy</button>
    </div>
  );
}
