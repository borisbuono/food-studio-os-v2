"use client";
import { useState, useMemo } from "react";

type EntityCode = "IFL" | "BM" | "BBH";
type AnomalyKind =
  | "eod_cash_ratio_high"
  | "eod_no_source"
  | "bank_movement_unmatched_long"
  | "invoice_missing_supplier"
  | "invoice_amount_outlier"
  | "duplicate_asiento"
  | "posting_before_bank"
  | "vat_ratio_deviation"
  | "intercompany_ghost";

type Row = {
  id: string;
  entity_code: EntityCode;
  kind: AnomalyKind;
  description: string;
  severity: number;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  snoozed_until: string | null;
  meta: Record<string, any> | null;
  first_seen_date: string;
  last_seen_date: string;
  source_table: string | null;
  source_id: string | null;
  updated_at: string;
};

const KIND_LABEL: Record<AnomalyKind, string> = {
  eod_cash_ratio_high:          "EOD cash ratio",
  eod_no_source:                "EOD missing POS",
  bank_movement_unmatched_long: "Bank unmatched > 14d",
  invoice_missing_supplier:     "Invoice · no supplier",
  invoice_amount_outlier:       "Invoice amount outlier",
  duplicate_asiento:            "Duplicate asiento",
  posting_before_bank:          "Posted before bank",
  vat_ratio_deviation:          "VAT ratio deviation",
  intercompany_ghost:           "Intercompany ghost",
};

// Best-guess link for the "Link to source" affordance in the drawer.
// Anomalies don't always resolve to a single source row (VAT deviation is
// a whole-month aggregate), so this returns null when we can't be sure.
function sourceHref(r: Row): string | null {
  if (r.kind === "eod_cash_ratio_high" || r.kind === "eod_no_source") return "/administrate/finance/eod";
  if (r.kind === "bank_movement_unmatched_long" || r.kind === "duplicate_asiento" || r.kind === "intercompany_ghost") return "/administrate/finance/reconciliation";
  if (r.kind === "invoice_missing_supplier" || r.kind === "invoice_amount_outlier" || r.kind === "posting_before_bank") return "/administrate/finance/scans";
  if (r.kind === "vat_ratio_deviation") return "/administrate/finance/dashboard";
  return null;
}

function sevPill(severity: number) {
  if (severity >= 4) return "border-tomato/40 bg-tomato/10 text-tomato";
  if (severity === 3) return "border-clay/40 bg-clay/10 text-clay";
  return "border-line bg-paper-deep text-ink-soft";
}

const shortDate = (s: string | null) => (s ? s.slice(0, 10) : "—");
const shortDt   = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "—");

export default function AnomaliesClient({ rows }: { rows: Row[] }) {
  const [entity, setEntity] = useState<"" | EntityCode>("");
  const [minSev, setMinSev] = useState<number>(1);
  const [showResolved, setShowResolved] = useState<"open" | "resolved">("open");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [live, setLive] = useState<Row[]>(rows);

  const filtered = useMemo(() => {
    let r = live.slice();
    if (entity) r = r.filter((x) => x.entity_code === entity);
    r = r.filter((x) => (x.severity ?? 2) >= minSev);
    if (showResolved === "open") r = r.filter((x) => !x.resolved_at);
    if (showResolved === "resolved") r = r.filter((x) => !!x.resolved_at);
    return r.sort((a, b) => {
      const s = (b.severity ?? 2) - (a.severity ?? 2);
      if (s !== 0) return s;
      return (b.last_seen_date || "").localeCompare(a.last_seen_date || "");
    });
  }, [live, entity, minSev, showResolved]);

  const counts = useMemo(() => {
    const c = { total: live.length, IFL: 0, BM: 0, BBH: 0, open: 0 } as Record<string, number>;
    for (const r of live) {
      c[r.entity_code] += 1;
      if (!r.resolved_at) c.open += 1;
    }
    return c;
  }, [live]);

  const drawerRow = useMemo(() => live.find((r) => r.id === drawerId) || null, [live, drawerId]);

  async function markResolved(id: string) {
    setPending(true);
    try {
      const res = await fetch("/api/finance/anomalies/" + id + "/resolve", { method: "POST" });
      if (res.ok) setLive((rs) => rs.map((r) => (r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r)));
    } finally {
      setPending(false);
    }
  }
  async function snooze7d(id: string) {
    setPending(true);
    try {
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const res = await fetch("/api/finance/anomalies/" + id + "/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ until }),
      });
      if (res.ok) setLive((rs) => rs.map((r) => (r.id === id ? { ...r, snoozed_until: until } : r)));
    } finally {
      setPending(false);
    }
  }

  async function rescan() {
    setPending(true);
    try {
      const res = await fetch("/api/finance/anomalies/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entities: ["IFL", "BM", "BBH"] }),
      });
      if (res.ok) {
        // Re-pull rows via GET — the client refresh is cheaper than a full reload.
        const g = await fetch("/api/finance/anomalies/scan?entity=IFL");
        // No single endpoint returns all three entities' rows, so we just
        // reload the page; simplest and honest.
        window.location.reload();
        void g;
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "" as const, label: "All (" + counts.total + ")" },
            { key: "IFL" as const, label: "IFL (" + counts.IFL + ")" },
            { key: "BM"  as const, label: "BM ("  + counts.BM  + ")" },
            { key: "BBH" as const, label: "BBH (" + counts.BBH + ")" },
          ].map((c) => (
            <button
              key={c.key}
              onClick={() => setEntity(c.key)}
              className={"rounded-full px-3 py-1 font-sans text-[12px] transition " + (entity === c.key ? "text-white" : "border border-black/10 text-ink-soft hover:border-line")}
              style={entity === c.key ? { backgroundColor: "var(--accent)" } : undefined}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Severity ≥</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={minSev}
            onChange={(e) => setMinSev(Number(e.target.value))}
            className="h-1 w-28 accent-current"
            style={{ color: "var(--accent)" }}
          />
          <span className="font-mono text-[11px] text-ink">{minSev}</span>
        </div>

        <div className="flex gap-1.5">
          {(["open", "resolved"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setShowResolved(k)}
              className={"rounded-full px-3 py-1 font-sans text-[12px] transition " + (showResolved === k ? "text-white" : "border border-black/10 text-ink-soft hover:border-line")}
              style={showResolved === k ? { backgroundColor: "var(--accent)" } : undefined}
            >
              {k === "open" ? "Unresolved (" + counts.open + ")" : "Resolved"}
            </button>
          ))}
        </div>

        <button
          onClick={rescan}
          disabled={pending}
          className="ml-auto rounded-full border border-black/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide hover:border-ink-soft disabled:opacity-50"
          style={{ color: "var(--accent)" }}
        >
          {pending ? "…" : "Rescan now"}
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="min-w-full text-left font-sans text-[13px]">
          <thead className="bg-paper-deep">
            <tr>
              <Th className="w-16">Sev</Th>
              <Th className="w-16">Entity</Th>
              <Th className="w-56">Kind</Th>
              <Th>Description</Th>
              <Th className="w-28">First seen</Th>
              <Th className="w-24 text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-line align-top hover:bg-paper-deep/40 cursor-pointer" onClick={() => setDrawerId(r.id)}>
                <Td>
                  <span className={"rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + sevPill(r.severity)}>
                    S{r.severity}
                  </span>
                </Td>
                <Td><span className="font-mono text-[11px] uppercase tracking-wide text-clay">{r.entity_code}</span></Td>
                <Td><span className="font-mono text-[12px] text-ink-soft">{KIND_LABEL[r.kind] || r.kind}</span></Td>
                <Td><span className="font-serif italic text-[13px] leading-snug text-ink">{r.description}</span></Td>
                <Td><span className="font-mono text-[12px] text-ink-soft">{shortDate(r.first_seen_date)}</span></Td>
                <Td className="text-right">
                  <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open →</span>
                </Td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <Td colSpan={6}>
                  <p className="py-8 text-center font-serif italic text-muted">
                    {live.length === 0
                      ? "No anomalies. Detection runs nightly and after significant activity."
                      : "No anomalies for this filter."}
                  </p>
                </Td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
        {drawerRow ? (
          <Drawer row={drawerRow} pending={pending} onClose={() => setDrawerId(null)} onResolve={markResolved} onSnooze={snooze7d} />
        ) : (
          <div className="hidden lg:block rounded-2xl border border-line bg-paper-deep/40 p-6">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">No selection</p>
            <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Pick a row on the left to inspect meta, resolve, or snooze.</p>
          </div>
        )}
      </div>
    </>
  );
}

function Drawer({
  row, pending, onClose, onResolve, onSnooze,
}: {
  row: Row; pending: boolean;
  onClose: () => void;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const href = sourceHref(row);
  return (
    <div className="fixed inset-0 z-40 flex justify-end lg:relative lg:inset-auto lg:z-auto lg:block" role="dialog" aria-modal="true">
      <button aria-label="Close drawer" onClick={onClose} className="absolute inset-0 bg-ink/30 lg:hidden" />
      <aside className="relative z-10 h-full w-full max-w-lg overflow-y-auto bg-paper px-6 py-8 shadow-xl lg:h-auto lg:max-w-none lg:rounded-2xl lg:border lg:border-line lg:shadow-none lg:py-6">
        <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">← back</button>
        <div className="mt-4 flex items-center gap-2">
          <span className={"rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + sevPill(row.severity)}>
            S{row.severity}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{row.entity_code}</span>
          <span className="font-mono text-[11px] text-ink-soft">· {KIND_LABEL[row.kind] || row.kind}</span>
        </div>
        <h2 className="mt-3 font-serif text-[22px] leading-snug text-ink">{row.description}</h2>

        <dl className="mt-6 grid grid-cols-2 gap-y-3 border-t border-line pt-4 font-mono text-[11px]">
          <dt className="uppercase tracking-wide text-clay">First seen</dt><dd className="text-ink">{shortDate(row.first_seen_date)}</dd>
          <dt className="uppercase tracking-wide text-clay">Last seen</dt><dd className="text-ink">{shortDate(row.last_seen_date)}</dd>
          <dt className="uppercase tracking-wide text-clay">Detected</dt><dd className="text-ink">{shortDt(row.detected_at)}</dd>
          <dt className="uppercase tracking-wide text-clay">Updated</dt><dd className="text-ink">{shortDt(row.updated_at)}</dd>
          {row.resolved_at ? (<><dt className="uppercase tracking-wide text-clay">Resolved</dt><dd className="text-basil">{shortDt(row.resolved_at)}</dd></>) : null}
          {row.snoozed_until ? (<><dt className="uppercase tracking-wide text-clay">Snoozed until</dt><dd className="text-ink">{shortDt(row.snoozed_until)}</dd></>) : null}
          {row.source_table ? (<><dt className="uppercase tracking-wide text-clay">Source table</dt><dd className="text-ink">{row.source_table}</dd></>) : null}
          {row.source_id ? (<><dt className="uppercase tracking-wide text-clay">Source id</dt><dd className="text-ink break-all">{row.source_id}</dd></>) : null}
        </dl>

        {row.meta && Object.keys(row.meta).length > 0 ? (
          <section className="mt-6 border-t border-line pt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Meta</p>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-paper-deep p-3 font-mono text-[11px] leading-snug text-ink-soft">{JSON.stringify(row.meta, null, 2)}</pre>
          </section>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-2">
          {!row.resolved_at ? (
            <>
              <button
                disabled={pending}
                onClick={() => onResolve(row.id)}
                className="rounded-full border border-basil/40 bg-basil/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-basil hover:bg-basil/20 disabled:opacity-50"
              >
                Mark resolved
              </button>
              <button
                disabled={pending}
                onClick={() => onSnooze(row.id)}
                className="rounded-full border border-black/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:border-ink-soft disabled:opacity-50"
              >
                Snooze 7d
              </button>
            </>
          ) : (
            <span className="font-serif italic text-[13px] text-ink-soft">This anomaly is resolved. It will re-open if the detector sees it again.</span>
          )}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-black/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide hover:border-ink-soft"
              style={{ color: "var(--accent)" }}
            >
              Link to source ↗
            </a>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-clay " + (className || "")}>{children}</th>;
}
function Td({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td className={"px-3 py-3 " + (className || "")} colSpan={colSpan}>{children}</td>;
}
