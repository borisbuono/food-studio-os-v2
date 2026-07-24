"use client";

import { useEffect, useState } from "react";

// Right-pane preview for the reconciliation split view (desktop lg+ only).
//
// Listens for `fs:recon:preview` window events dispatched by ProposedMatchesClient
// with { detail: { movementId, description, amount_eur, movement_date,
// bank_account, top_match_target_label, top_match_type, top_confidence } }.
// Renders a compact "source card" that mirrors what the drawer shows on
// mobile, but sits permanently visible on wide screens so operators can
// scan the candidate alongside the movement list.

type PreviewPayload = {
  movementId: string;
  description?: string | null;
  amount_eur?: number | null;
  movement_date?: string | null;
  bank_account?: string | null;
  top_match_target_label?: string | null;
  top_match_type?: string | null;
  top_confidence?: number | null;
  top_rationale?: string | null;
};

const eur = (n: number | null | undefined) => {
  const v = Number(n || 0);
  return (v < 0 ? "-€" : "€") + Math.abs(v).toFixed(2);
};

export default function ReconciliationSourcePreview() {
  const [row, setRow] = useState<PreviewPayload | null>(null);

  useEffect(() => {
    const on = (e: any) => {
      if (e?.detail && typeof e.detail === "object") setRow(e.detail as PreviewPayload);
    };
    const clear = () => setRow(null);
    window.addEventListener("fs:recon:preview", on as any);
    window.addEventListener("fs:recon:preview:clear", clear as any);
    return () => {
      window.removeEventListener("fs:recon:preview", on as any);
      window.removeEventListener("fs:recon:preview:clear", clear as any);
    };
  }, []);

  if (!row) {
    return (
      <aside className="hidden lg:block rounded-2xl border border-line bg-paper-deep/40 p-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Source preview</p>
        <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
          Hover a proposed match on the left to preview the source it points at
          — invoice, EOD, asiento or the free-form fallback. Accept in the row,
          or drill in for alternatives.
        </p>
      </aside>
    );
  }

  const conf = Number(row.top_confidence || 0);
  return (
    <aside className="hidden lg:block sticky top-4 rounded-2xl border border-line bg-paper p-6">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Source preview</p>
      <div className="mt-3 border-t border-line pt-3">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
          {row.movement_date ? new Date(row.movement_date).toLocaleDateString("en-GB") : "—"} · {row.bank_account || "—"}
        </p>
        <p className="mt-1 font-serif text-[18px] leading-snug text-ink">{row.description || "—"}</p>
        <p className="mt-1 font-mono text-[13px] text-ink-soft">{eur(row.amount_eur)}</p>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Top candidate</p>
        <p className="mt-1 font-sans text-[13px] text-ink">{row.top_match_target_label || "—"}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-clay">
          {row.top_match_type || "—"} · {(conf * 100).toFixed(0)}% confidence
        </p>
        {row.top_rationale ? (
          <p className="mt-2 font-serif italic text-[13px] leading-snug text-ink-soft">{row.top_rationale}</p>
        ) : null}
      </div>
    </aside>
  );
}
