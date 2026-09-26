"use client";
import { useState } from "react";

// One document, one tick. No batch form exists on purpose
// (CEO condition 3 / feedback_human_in_loop_accounting).

type Cand = { id: string; docNumber: string | null; contactName: string | null; date: string; total: number; why: string };
type Pre = { ok: true; mode: "preflight"; blockers: string[]; warnings: string[]; in_holded: Cand[]; payload: any; dry_run: boolean };

const eur = (n: number) => "€" + Number(n).toFixed(2);
const btn = "rounded-lg border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide";

export default function PushToHolded({ id, entity, total }: { id: string; entity: string; total: number | null }) {
  const [pre, setPre] = useState<Pre | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ holded_doc_id: string; note: string } | null>(null);
  const [arm, setArm] = useState<string | null>(null); // "create" | holded id

  async function call(mode: string, holded_id?: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/capture/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, mode, holded_id }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error + (j.detail ? " · " + JSON.stringify(j.detail).slice(0, 240) : "")); return; }
      if (mode === "preflight") setPre(j);
      else if (j.dry_run) setErr("Dry-run is on (FS_HOLDED_DRY_RUN) — nothing was sent. Payload: " + JSON.stringify(j.payload).slice(0, 300));
      else setDone({ holded_doc_id: j.holded_doc_id, note: mode === "create" ? `Draft created, PDF attached, read back ${j.readback?.total ? "✓ total" : ""} — NOT approved in Holded` : "PDF attached to the existing Holded doc" });
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); setArm(null); }
  }

  if (done) return (
    <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-basil">
      In Holded · {done.note} · <a className="underline" target="_blank" rel="noreferrer" href={"https://app.holded.com/invoices/purchase/" + done.holded_doc_id}>open →</a>
    </p>
  );

  return (
    <div className="mt-3">
      {!pre ? (
        <button disabled={busy} onClick={() => call("preflight")} className={btn + " text-ink"}>{busy ? "Checking Holded…" : "Check against Holded"}</button>
      ) : (
        <div className="rounded-xl border border-line p-3">
          {pre.dry_run ? <p className="font-mono text-[10px] uppercase tracking-wide text-amber">Dry-run on — a push will not reach Holded</p> : null}
          {pre.blockers.length ? (
            <p className="font-mono text-[10px] uppercase tracking-wide text-tomato">Blocked: {pre.blockers.map((b) => b.replace(/_/g, " ")).join(" · ")}</p>
          ) : null}
          {pre.warnings.length ? <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-amber">Check: {pre.warnings.map((b) => b.replace(/_/g, " ")).join(" · ")}</p> : null}
          {pre.in_holded.length ? (
            <div className="mt-2">
              <p className="font-serif text-[14px] text-ink">Already in {entity} Holded — don't create another. Attach this scan to it instead:</p>
              <ul className="mt-1 space-y-1">
                {pre.in_holded.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-ink-soft">
                    <a className="underline" target="_blank" rel="noreferrer" href={"https://app.holded.com/invoices/purchase/" + c.id}>{c.docNumber || "(no number)"}</a>
                    <span>{c.contactName} · {c.date} · {eur(c.total)} · {c.why}</span>
                    {arm === c.id ? (
                      <button disabled={busy} onClick={() => call("attach_existing", c.id)} className={btn + " text-ink"}>{busy ? "Attaching…" : "Confirm: attach PDF"}</button>
                    ) : (
                      <button disabled={busy} onClick={() => setArm(c.id)} className={btn + " text-ink-soft"}>Attach PDF here</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!pre.blockers.length && !pre.in_holded.length ? (
            <div className="mt-2">
              <p className="font-serif text-[14px] text-ink">
                Not in {entity} Holded. Push creates a <b>draft</b> purchase ({pre.payload?.items?.length || 0} line{pre.payload?.items?.length === 1 ? "" : "s"}, one per IVA rate{total != null ? `, total ${eur(total)}` : ""}), attaches the scanned PDF and reads it back. Approval stays in Holded.
              </p>
              {arm === "create" ? (
                <button disabled={busy} onClick={() => call("create")} className={btn + " mt-2 text-ink"} style={{ borderColor: "var(--accent)" }}>{busy ? "Pushing…" : `Confirm: push this one to ${entity}`}</button>
              ) : (
                <button disabled={busy} onClick={() => setArm("create")} className={btn + " mt-2 text-ink"}>Push to Holded</button>
              )}
            </div>
          ) : null}
        </div>
      )}
      {err ? <p className="mt-2 font-mono text-[11px] text-tomato">{err}</p> : null}
    </div>
  );
}
