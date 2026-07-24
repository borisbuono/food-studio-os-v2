"use client";
import { useMemo, useState } from "react";

type EntityCode = "IFL" | "BM" | "BBH";

export type OpenMatch = {
  movement_id: string;
  entity_code: EntityCode;
  bank_account: string;
  movement_date: string;
  amount_eur: number;
  description: string | null;
  reconciled_status: string;
  top_candidate_id: string | null;
  top_match_type: string | null;
  top_match_target_id: string | null;
  top_match_target_label: string | null;
  top_finder: string | null;
  top_confidence: number | null;
  top_rationale: string | null;
};

export type AltCandidate = {
  id: string;
  bank_movement_id: string;
  match_type: string;
  match_target_id: string | null;
  match_target_label: string | null;
  finder: string;
  confidence: number;
  rationale: string;
};

const TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  eod: "EOD",
  asiento: "Asiento",
  intercompany: "Intercompany",
  salary: "Salary",
  tax: "Tax",
  "self-transfer": "Self-transfer",
  unknown: "AI guess",
};

const eur = (n: number) => (n < 0 ? "-€" : "€") + Math.abs(Number(n || 0)).toFixed(2);

function confPill(c: number | null) {
  const v = Number(c || 0);
  if (v >= 0.9) return { cls: "border-basil/40 bg-basil/10 text-basil", label: (v * 100).toFixed(0) + "% ·  high" };
  if (v >= 0.75) return { cls: "border-clay/40 bg-clay/10 text-clay", label: (v * 100).toFixed(0) + "% · mid" };
  return { cls: "border-line bg-paper-deep text-ink-soft", label: (v * 100).toFixed(0) + "% · low" };
}

export default function ProposedMatchesClient({
  rows,
  altsByMovement,
  entityCode,
}: { rows: OpenMatch[]; altsByMovement: Record<string, AltCandidate[]>; entityCode: EntityCode }) {
  const [live, setLive] = useState<OpenMatch[]>(rows);
  const [alts, setAlts] = useState<Record<string, AltCandidate[]>>(altsByMovement);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [manualNote, setManualNote] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [confFilter, setConfFilter] = useState<"all" | "high" | "mid" | "low">("all");
  const [scanRunning, setScanRunning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string>("");

  const filtered = useMemo(() => {
    return live.filter((r) => {
      const c = Number(r.top_confidence || 0);
      if (confFilter === "high" && c < 0.9) return false;
      if (confFilter === "mid" && (c < 0.75 || c >= 0.9)) return false;
      if (confFilter === "low" && c >= 0.75) return false;
      return true;
    });
  }, [live, confFilter]);

  const withCandidate = filtered.filter((r) => r.top_candidate_id);
  const withoutCandidate = filtered.filter((r) => !r.top_candidate_id);
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  async function runScan() {
    setScanRunning(true);
    setScanMsg("");
    try {
      const r = await fetch("/api/finance/reconciliation/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_code: entityCode, limit: 200 }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "scan failed");
      const s = r.summary;
      setScanMsg("Scanned " + s.scanned + " · " + s.candidates_upserted + " candidates upserted · " + s.ai_fallbacks + " AI fallbacks. Refresh to see them.");
    } catch (e: any) { setScanMsg("Scan failed: " + (e?.message || e)); }
    finally { setScanRunning(false); }
  }

  async function decide(candidateId: string, decision: "accept" | "reject", movementId: string) {
    setPending(true);
    try {
      const r = await fetch("/api/finance/reconciliation/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId, decision }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "decision failed");
      setLive((L) => L.filter((x) => x.movement_id !== movementId));
      setAlts((A) => { const n = { ...A }; delete n[movementId]; return n; });
      setSelected((S) => { const n = { ...S }; delete n[candidateId]; return n; });
      setDrawerFor(null);
    } catch (e) { alert(e); }
    finally { setPending(false); }
  }

  async function bulkAccept() {
    if (!selectedIds.length) return;
    setPending(true);
    try {
      const r = await fetch("/api/finance/reconciliation/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate_ids: selectedIds, decision: "accept" }),
      }).then((x) => x.json());
      if (r.accepted) {
        setLive((L) => L.filter((x) => !(x.top_candidate_id && selectedIds.includes(x.top_candidate_id))));
        setSelected({});
      }
    } catch (e) { alert(e); }
    finally { setPending(false); }
  }

  async function markManual(movementId: string) {
    setPending(true);
    try {
      const r = await fetch("/api/finance/reconciliation/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ movement_id: movementId, decision: "manual", note: manualNote || undefined }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setLive((L) => L.filter((x) => x.movement_id !== movementId));
      setDrawerFor(null);
      setManualNote("");
    } catch (e) { alert(e); }
    finally { setPending(false); }
  }

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={runScan}
          disabled={scanRunning}
          className="rounded-full border border-ink px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-paper-deep disabled:opacity-50">
          {scanRunning ? "scanning…" : "run matcher"}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Filter</span>
        {(["all", "high", "mid", "low"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setConfFilter(k)}
            className={"rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide " + (confFilter === k ? "border-ink bg-paper-deep text-ink" : "border-line text-ink-soft hover:border-ink-soft")}>
            {k === "all" ? "all" : k === "high" ? "≥ 90%" : k === "mid" ? "75–90%" : "< 75%"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
            {selectedIds.length} selected
          </span>
          <button
            onClick={bulkAccept}
            disabled={!selectedIds.length || pending}
            className="rounded-full border border-basil px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-basil hover:bg-basil/10 disabled:opacity-40">
            Accept selected
          </button>
        </div>
      </div>
      {scanMsg ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft">{scanMsg}</p>
      ) : null}

      {withCandidate.length === 0 && withoutCandidate.length === 0 ? (
        <p className="mt-6 font-serif italic text-[15px] text-ink-soft">
          Nothing waiting — every open movement has been triaged. Run the matcher above if you've just imported new bank statements.
        </p>
      ) : null}

      {withCandidate.length ? (
        <section className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Proposed · {withCandidate.length}</p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {withCandidate.map((r) => {
              const pill = confPill(r.top_confidence);
              const positive = Number(r.amount_eur) >= 0;
              const checked = !!(r.top_candidate_id && selected[r.top_candidate_id]);
              return (
                <li key={r.movement_id} className="py-3">
                  <div className="flex items-baseline gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (!r.top_candidate_id) return;
                        setSelected((S) => ({ ...S, [r.top_candidate_id!]: e.target.checked }));
                      }}
                      className="mt-1 h-3 w-3"
                    />
                    <button
                      onMouseEnter={() => { try { window.dispatchEvent(new CustomEvent("fs:recon:preview", { detail: { movementId: r.movement_id, description: r.description, amount_eur: r.amount_eur, movement_date: r.movement_date, bank_account: r.bank_account, top_match_target_label: r.top_match_target_label, top_match_type: r.top_match_type, top_confidence: r.top_confidence, top_rationale: r.top_rationale } })); } catch {} }}
                      onFocus={() => { try { window.dispatchEvent(new CustomEvent("fs:recon:preview", { detail: { movementId: r.movement_id, description: r.description, amount_eur: r.amount_eur, movement_date: r.movement_date, bank_account: r.bank_account, top_match_target_label: r.top_match_target_label, top_match_type: r.top_match_type, top_confidence: r.top_confidence, top_rationale: r.top_rationale } })); } catch {} }}
                      onClick={() => setDrawerFor(r.movement_id)}
                      className="grow text-left">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-serif text-[15px] text-ink">{r.description || "—"}</span>
                        <span className={"font-mono text-[13px] " + (positive ? "text-basil" : "text-tomato")}>
                          {positive ? "+" : ""}{eur(Number(r.amount_eur))}
                        </span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                        <span>{new Date(r.movement_date).toLocaleDateString("en-GB")} · {r.bank_account}</span>
                        <span className={"rounded-full border px-2 py-[1px] " + pill.cls}>{pill.label}</span>
                        <span className="text-ink-soft">→ {TYPE_LABEL[r.top_match_type || ""] || r.top_match_type} · {r.top_match_target_label || "—"}</span>
                      </p>
                      <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{r.top_rationale}</p>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        disabled={pending}
                        onClick={() => r.top_candidate_id && decide(r.top_candidate_id, "accept", r.movement_id)}
                        className="rounded-full border border-basil px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-basil hover:bg-basil/10 disabled:opacity-40">
                        Accept
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => r.top_candidate_id && decide(r.top_candidate_id, "reject", r.movement_id)}
                        className="rounded-full border border-line px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-ink-soft disabled:opacity-40">
                        Reject
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => setDrawerFor(r.movement_id)}
                        className="rounded-full border border-line px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-ink-soft disabled:opacity-40">
                        Manual
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {withoutCandidate.length ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Unmatched, no candidate · {withoutCandidate.length}</p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {withoutCandidate.slice(0, 40).map((r) => {
              const positive = Number(r.amount_eur) >= 0;
              return (
                <li key={r.movement_id} className="py-2">
                  <button className="w-full text-left" onClick={() => setDrawerFor(r.movement_id)}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-serif text-[14px] text-ink">{r.description || "—"}</span>
                      <span className={"font-mono text-[12px] " + (positive ? "text-basil" : "text-tomato")}>{positive ? "+" : ""}{eur(Number(r.amount_eur))}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">{new Date(r.movement_date).toLocaleDateString("en-GB")} · {r.bank_account}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {drawerFor ? (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/40 sm:items-center sm:justify-center" onClick={() => setDrawerFor(null)}>
          <div
            className="w-full max-w-lg rounded-t-3xl border border-line bg-paper p-6 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Quick reconcile</p>
            {(() => {
              const r = live.find((x) => x.movement_id === drawerFor);
              if (!r) return null;
              const list = alts[drawerFor!] || (r.top_candidate_id ? [{
                id: r.top_candidate_id,
                bank_movement_id: r.movement_id,
                match_type: r.top_match_type || "unknown",
                match_target_id: r.top_match_target_id,
                match_target_label: r.top_match_target_label,
                finder: r.top_finder || "",
                confidence: Number(r.top_confidence || 0),
                rationale: r.top_rationale || "",
              } as AltCandidate] : []);
              const positive = Number(r.amount_eur) >= 0;
              return (
                <>
                  <h2 className="mt-1 font-serif text-2xl text-ink leading-tight">{r.description || "Movement"}</h2>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {new Date(r.movement_date).toLocaleDateString("en-GB")} · {r.bank_account} · <span className={positive ? "text-basil" : "text-tomato"}>{positive ? "+" : ""}{eur(Number(r.amount_eur))}</span>
                  </p>
                  {list.length ? (
                    <>
                      <p className="mt-5 font-mono text-[10px] uppercase tracking-wide text-clay">Top candidates</p>
                      <ul className="mt-2 divide-y divide-line border-t border-line">
                        {list.slice(0, 3).map((c) => {
                          const pill = confPill(c.confidence);
                          return (
                            <li key={c.id} className="py-3">
                              <div className="flex items-baseline justify-between gap-2">
                                <div>
                                  <p className="font-serif text-[14px] text-ink">{TYPE_LABEL[c.match_type] || c.match_type} · {c.match_target_label || "—"}</p>
                                  <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{c.rationale}</p>
                                  <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-ink-soft">finder: {c.finder}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <span className={"rounded-full border px-2 py-[1px] font-mono text-[10px] uppercase tracking-wide " + pill.cls}>{pill.label}</span>
                                  <button
                                    disabled={pending}
                                    onClick={() => decide(c.id, "accept", r.movement_id)}
                                    className="rounded-full border border-basil px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-basil hover:bg-basil/10">
                                    Accept
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-6 font-serif italic text-[14px] text-ink-soft">No candidate found. Reconcile this movement manually.</p>
                  )}
                  <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Manual reconcile</p>
                  <textarea
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Note (optional) — e.g. matched to Holded doc F250099"
                    className="mt-2 w-full rounded-lg border border-line bg-paper-deep px-3 py-2 font-mono text-[12px] text-ink"
                    rows={2}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={pending}
                      onClick={() => markManual(r.movement_id)}
                      className="rounded-full border border-ink px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-paper-deep disabled:opacity-40">
                      Mark reconciled manually
                    </button>
                    <button
                      onClick={() => setDrawerFor(null)}
                      className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:border-ink-soft">
                      Close
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
