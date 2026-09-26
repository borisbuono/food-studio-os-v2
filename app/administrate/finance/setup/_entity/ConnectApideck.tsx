"use client";
import { useEffect, useState } from "react";

// Apideck-managed accounting: no API key entered here. We call our /api/integrations/apideck/session
// route, which asks Apideck to mint a hosted Vault URL and (optionally) marks an entity_integrations
// row so /administrate/finance/setup shows the connection. The user completes authorization in
// Apideck's chooser and returns.
export default function ConnectApideck({ entity }: { entity: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const load = async () => {
    const r = await fetch(`/api/integrations/list?entity=${entity}`);
    const d = await r.json();
    setRows((d.integrations || []).filter((x: any) => x.platform === "apideck"));
  };
  useEffect(() => { load(); }, [entity]);
  const active = rows[0];

  const openVault = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/integrations/apideck/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity }) });
    const d = await r.json();
    setBusy(false);
    if (d.ok && d.session_uri) { window.open(d.session_uri, "_blank", "noopener"); setMsg("↗ Vault chooser opened in a new tab. Finish there, then click 'refresh' below."); await load(); }
    else setMsg("⚠ " + (d.error || "session failed"));
  };

  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="font-serif text-[15px] text-ink">Apideck (unified accounting)</p>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">apideck · accounting · Holded / QuickBooks / Xero / Sage</p>
        </div>
        {active ? (
          <span className="inline-block rounded-full border border-basil/40 bg-basil/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-basil">managed</span>
        ) : (
          <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">not connected</span>
        )}
      </div>
      <p className="mt-2 font-serif italic text-[13px] text-ink-soft">One button. Apideck hosts the vendor authorization — pat_ tokens for Holded, OAuth for QuickBooks/Xero. Rotate or revoke from Apideck's dashboard; we hold zero credentials.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={openVault} disabled={busy} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">{busy ? "opening…" : active ? "↑ manage in vault" : "connect via apideck →"}</button>
        <button onClick={load} disabled={busy} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">↻ refresh</button>
      </div>
      {msg ? <p className="mt-2 font-mono text-[10px] text-ink">{msg}</p> : null}
    </div>
  );
}
