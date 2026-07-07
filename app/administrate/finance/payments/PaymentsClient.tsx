"use client";
import { useState, useMemo } from "react";

type Row = {
  id: string;
  entity_code: "IFL" | "BM" | "BBH";
  platform: string;
  state: "healthy" | "at_risk" | "failing" | "disabled" | "missing_card";
  card_last4: string | null;
  next_charge_date: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count_30d: number;
  billing_url: string | null;
  notes: string | null;
  updated_at: string;
};

const SEVERITY: Record<Row["state"], number> = {
  disabled: 0, failing: 1, at_risk: 2, missing_card: 3, healthy: 4,
};

const PLATFORM_LABEL: Record<string, string> = {
  "google-workspace": "Google Workspace",
  "wix-newsletter": "Wix",
  "meta-ads": "Meta Ads",
  "holded": "Holded",
  "apideck": "Apideck",
};
const platformLabel = (p: string) => PLATFORM_LABEL[p] || p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function pillClasses(state: Row["state"]) {
  switch (state) {
    case "disabled":
    case "failing":      return "border-tomato/40 bg-tomato/10 text-tomato";
    case "at_risk":      return "border-clay/40 bg-clay/10 text-clay";
    case "missing_card": return "border-line bg-paper-deep text-muted";
    case "healthy":      return "border-basil/40 bg-basil/10 text-basil";
  }
}

const shortDate = (s: string | null) => s ? s.slice(0, 10) : "—";

export default function PaymentsClient({ rows }: { rows: Row[] }) {
  const [entity, setEntity] = useState<"" | "IFL" | "BM" | "BBH">("");
  const filtered = useMemo(() => {
    const r = entity ? rows.filter((x) => x.entity_code === entity) : rows;
    return r.slice().sort((a, b) => {
      const s = SEVERITY[a.state] - SEVERITY[b.state];
      if (s !== 0) return s;
      return (b.failure_count_30d || 0) - (a.failure_count_30d || 0)
          || a.entity_code.localeCompare(b.entity_code)
          || a.platform.localeCompare(b.platform);
    });
  }, [entity, rows]);

  const counts = useMemo(() => {
    const c = { total: rows.length, IFL: 0, BM: 0, BBH: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.entity_code] += 1; });
    return c;
  }, [rows]);

  return (
    <>
      {/* Filter chips per entity */}
      <div className="mt-6 flex flex-wrap gap-1.5">
        {[
          { key: "" as const, label: `All (${counts.total})` },
          { key: "IFL" as const, label: `IFL (${counts.IFL})` },
          { key: "BM" as const, label: `BM (${counts.BM})` },
          { key: "BBH" as const, label: `BBH (${counts.BBH})` },
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

      <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
        <table className="min-w-full text-left font-sans text-[13px]">
          <thead className="bg-paper-deep">
            <tr>
              <Th>Entity</Th>
              <Th>Platform</Th>
              <Th>State</Th>
              <Th>Card</Th>
              <Th>Last success</Th>
              <Th>Last failure</Th>
              <Th className="text-right">Fails 30d</Th>
              <Th>Notes</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <Td><span className="font-mono text-[11px] uppercase tracking-wide text-clay">{r.entity_code}</span></Td>
                <Td>{platformLabel(r.platform)}</Td>
                <Td>
                  <span className={"rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + pillClasses(r.state)}>
                    {r.state.replace("_", " ")}
                  </span>
                </Td>
                <Td>{r.card_last4 ? <span className="font-mono text-[12px] text-ink-soft">···· {r.card_last4}</span> : <span className="text-muted">—</span>}</Td>
                <Td><span className="font-mono text-[12px] text-ink-soft">{shortDate(r.last_success_at)}</span></Td>
                <Td><span className="font-mono text-[12px] text-ink-soft">{shortDate(r.last_failure_at)}</span></Td>
                <Td className="text-right"><span className="font-mono text-[12px] text-ink">{r.failure_count_30d}</span></Td>
                <Td><span className="font-serif italic text-[12px] leading-snug text-ink-soft">{r.notes || ""}</span></Td>
                <Td className="text-right">
                  {r.billing_url ? (
                    <a
                      href={r.billing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-full border border-black/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide hover:border-ink-soft"
                      style={{ color: "var(--accent)" }}
                    >
                      Fix now ↗
                    </a>
                  ) : <span className="text-muted">—</span>}
                </Td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr><Td colSpan={9}><p className="py-6 text-center font-serif italic text-muted">No rows for this filter.</p></Td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-[10px] text-muted">
        Data is seeded from the 2026-07-05 marketing invoice map. Manual updates via <code>POST /api/finance/payment-status/sync</code>. Gmail-based auto-detection is a follow-up.
      </p>
    </>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-clay " + (className || "")}>{children}</th>;
}
function Td({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td className={"px-3 py-3 " + (className || "")} colSpan={colSpan}>{children}</td>;
}
