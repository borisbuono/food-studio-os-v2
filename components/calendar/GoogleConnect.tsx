"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Connect / sync / disconnect the read-only Google overlay. On mount, pulls
// again if the last pull is older than 15 min, then refreshes the page data.
export default function GoogleConnect() {
  const router = useRouter();
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/calendar/google/sync", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setSt(j);
    return j;
  };
  const sync = async (force = false) => {
    setBusy(true);
    await fetch(`/api/calendar/google/sync${force ? "?force=1" : ""}`, { method: "POST" }).catch(() => null);
    await load();
    setBusy(false);
    router.refresh();
  };
  useEffect(() => {
    load().then((j) => { if (j?.connected && j?.stale) sync(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st?.ok || st.configured === false) return null;
  if (!st.connected)
    return <a href="/api/calendar/google/start" className="rounded border border-black/15 px-2 py-1">Connect Google</a>;
  return (
    <span className="flex items-center gap-1">
      <button onClick={() => sync(true)} disabled={busy} title={st.last_error ? `Last error: ${st.last_error}` : `Google: ${st.email || "connected"}`}
        className={`rounded border px-2 py-1 ${st.last_error ? "border-tomato/50 text-tomato" : "border-black/15"}`}>
        {busy ? "Syncing…" : st.last_error ? "Google ⚠" : "Google ↻"}
      </button>
      <button onClick={async () => { if (!confirm("Disconnect Google calendar?")) return; await fetch("/api/calendar/google/disconnect", { method: "POST" }); await load(); router.refresh(); }}
        className="rounded border border-black/15 px-1.5 py-1 text-clay" title="Disconnect">×</button>
    </span>
  );
}
