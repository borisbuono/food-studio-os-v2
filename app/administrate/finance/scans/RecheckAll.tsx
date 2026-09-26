"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Re-file documents the funnel rejected or parked, under the current rules —
// from what was already read, one at a time. Nothing goes to Holded.
export default function RecheckAll({ items }: { items: { table: "invoice_inbox" | "albarans"; id: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  if (!items.length) return null;
  async function run() {
    setBusy(true); setDone(0); setLog([]);
    const out: string[] = [];
    for (const it of items) {
      try {
        const r = await fetch("/api/capture/reprocess", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(it) });
        const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
        out.push(j.ok ? `${j.status}${j.entity ? " · " + j.entity : ""}${j.flags?.length ? " · " + j.flags.join(", ") : ""}` : `error · ${j.error}`);
      } catch (e: any) { out.push("error · " + String(e?.message || e)); }
      setDone((d) => d + 1); setLog([...out]);
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <button disabled={busy} onClick={run} className="rounded-lg border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink">
        {busy ? `Re-checking… ${done} of ${items.length} — stay on this page` : `Re-check ${items.length} rejected / parked with the current rules`}
      </button>
      {log.length ? <ul className="mt-2 space-y-0.5">{log.map((l, i) => <li key={i} className="font-mono text-[11px] text-ink-soft">{l}</li>)}</ul> : null}
    </div>
  );
}
