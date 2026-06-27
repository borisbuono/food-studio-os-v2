"use client";
import { useState } from "react";

export default function SyncCardClient({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const run = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/finance/sync-holded", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: code }) });
    const d = await r.json();
    setMsg(d.ok ? `✓ ${d.adapter}: fetched ${d.fetched}, inserted/updated ${d.inserted}` : "⚠ " + (d.error || "failed"));
    setBusy(false);
  };
  return (
    <button onClick={run} className="block rounded-xl border border-line bg-paper p-4 text-left hover:border-ink-soft">
      <p className="font-serif text-[15px] text-ink">{busy ? "Syncing…" : "↻ Sync from accounting"}</p>
      <p className="mt-1 font-serif italic text-[13px] text-muted">Pulls every unapproved purchase into the inbox.</p>
      {msg ? <p className="mt-2 font-mono text-[11px] text-ink">{msg}</p> : null}
    </button>
  );
}
