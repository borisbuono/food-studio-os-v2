"use client";
import { useEffect, useState } from "react";

// Historic performance chart for the Ads surface. Reads
// /api/grow/reach/ads/insights?entity=BM which wraps Meta's /insights endpoint.
// When the account is DISABLED (which it is right now on BM) Meta still
// returns any spend / reach that happened before shutdown — that's why we
// still render the chart on top of a checklist that's meant to unblock a
// disabled account.
//
// Editorial identity: hairline SVG bars, no gridlines, one accent stroke.

type Row = { date: string; spend: number | null; reach: number | null };

export default function AdsInsightsChart({ entity }: { entity: "IFL" | "BM" }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = false;
    setLoading(true); setErr(""); setRows(null);
    fetch(`/api/grow/reach/ads/insights?entity=${entity}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `${r.status}`);
        return j.rows as Row[];
      })
      .then((rs) => { if (!done) { setRows(rs); setLoading(false); } })
      .catch((e) => { if (!done) { setErr(e?.message || String(e)); setLoading(false); } });
    return () => { done = true; };
  }, [entity]);

  if (loading) return <p className="mt-4 font-sans text-[13px] italic text-ink-soft">Loading last 90 days…</p>;
  if (err) return <p className="mt-4 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p>;
  if (!rows || rows.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-line bg-paper-deep p-8 text-center">
        <p className="font-sans text-[13px] italic text-ink-soft">No spend or reach on file for the last 90 days.</p>
        <p className="mt-2 font-sans text-[12px] text-ink-soft">Meta returns an empty series once an account has been disabled long enough — the chart back-fills when campaigns start delivering again.</p>
      </div>
    );
  }

  const w = 720, h = 180, padL = 32, padR = 8, padT = 12, padB = 20;
  const maxSpend = Math.max(1, ...rows.map((r) => Number(r.spend || 0)));
  const totalSpend = rows.reduce((a, r) => a + Number(r.spend || 0), 0);
  const totalReach = rows.reduce((a, r) => a + Number(r.reach || 0), 0);
  const bw = Math.max(2, Math.floor((w - padL - padR) / rows.length) - 1);

  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-6">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted">total spend · 90d</p>
          <p className="font-serif text-2xl text-ink">€{Math.round(totalSpend)}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted">total reach · 90d</p>
          <p className="font-serif text-2xl text-ink">{Math.round(totalReach).toLocaleString("en-GB")}</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full">
        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} className="stroke-ink-soft" strokeWidth={0.5} />
        {rows.map((r, i) => {
          const x = padL + i * (bw + 1);
          const bh = Math.round((Number(r.spend || 0) / maxSpend) * (h - padT - padB));
          const y = h - padB - bh;
          return (
            <rect
              key={r.date}
              x={x} y={y} width={bw} height={bh}
              className="fill-current"
              style={{ color: "var(--accent, #9A3122)" }}
            >
              <title>{r.date} · €{Math.round(Number(r.spend || 0))} · reach {Math.round(Number(r.reach || 0)).toLocaleString("en-GB")}</title>
            </rect>
          );
        })}
        <text x={padL} y={h - 4} className="fill-current font-mono text-[9px] uppercase tracking-wide" style={{ color: "var(--ink-soft, #6b7280)" }}>
          {rows[0]?.date}
        </text>
        <text x={w - padR} y={h - 4} textAnchor="end" className="fill-current font-mono text-[9px] uppercase tracking-wide" style={{ color: "var(--ink-soft, #6b7280)" }}>
          {rows[rows.length - 1]?.date}
        </text>
      </svg>
    </div>
  );
}
