"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// What the funnel refused to guess, a human settles here — one row at a time.
const ACKABLE: Record<string, string> = {
  vat_rate_category_mismatch: "I checked the printed IVA rate and it is right",
  low_confidence: "I checked the figures against the paper",
  handwritten_changes: "I checked the hand corrections",
};
const btn = "rounded-lg border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide";

export default function TriageControls({ table, id, entityGuessed, flags, issues }: {
  table: "invoice_inbox" | "albarans"; id: string; entityGuessed: boolean; flags: string[];
  issues?: { where: string; cat: string; printed: number; expected: number }[] | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const ack = flags.filter((f) => ACKABLE[f]);
  if (!entityGuessed && !ack.length && !(issues && issues.length)) return null;

  async function go(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/capture/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, id, ...body }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error); else { setOpen(null); setNote(""); router.refresh(); }
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 rounded-xl border border-line p-3">
      {issues && issues.length ? (
        <ul className="mb-2 space-y-0.5">
          {issues.map((i, k) => (
            <li key={k} className="font-mono text-[11px] text-tomato">IVA {i.printed}% on {i.cat.replace(/_/g, " ")} — {i.where}. Should be {i.expected}%: ask the supplier for a rectificativa, or confirm below.</li>
          ))}
        </ul>
      ) : null}
      {entityGuessed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-[14px] text-ink">Whose paper is this?</span>
          {["BM", "IFL", "BBH"].map((e) => (
            <button key={e} disabled={busy} onClick={() => go({ action: "set_entity", entity: e })} className={btn + " text-ink"}>{e}</button>
          ))}
        </div>
      ) : null}
      {ack.map((f) => (
        <div key={f} className="mt-2">
          {open === f ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="why it's right" className="min-w-[14rem] flex-1 rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
              <button disabled={busy || note.trim().length < 5} onClick={() => go({ action: "ack_flag", flag: f, note })} className={btn + " text-ink"}>Confirm</button>
              <button disabled={busy} onClick={() => setOpen(null)} className={btn + " text-ink-soft"}>Cancel</button>
            </div>
          ) : (
            <button disabled={busy} onClick={() => setOpen(f)} className={btn + " text-ink-soft"}>{ACKABLE[f]}</button>
          )}
        </div>
      ))}
      <div className="mt-2">
        {open === "reject" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="reason" className="min-w-[14rem] flex-1 rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
            <button disabled={busy || note.trim().length < 3} onClick={() => go({ action: "reject", note })} className={btn + " text-tomato"}>Reject</button>
          </div>
        ) : (
          <button disabled={busy} onClick={() => setOpen("reject")} className={btn + " text-ink-soft"}>Reject document</button>
        )}
      </div>
      {err ? <p className="mt-2 font-mono text-[11px] text-tomato">{err}</p> : null}
    </div>
  );
}
