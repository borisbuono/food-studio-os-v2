"use client";
import { useEffect, useState } from "react";

type Integration = { id: string; platform: string; status: string; last_check_at: string | null; last_error: string | null };

export default function ConnectIntegration({ entity, vendor, kind, label, howto }: { entity: string; vendor: string; kind: string; label: string; howto: string }) {
  const [rows, setRows] = useState<Integration[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const load = async () => {
    const r = await fetch(`/api/integrations/list?entity=${entity}`);
    const d = await r.json();
    setRows((d.integrations || []).filter((x: any) => x.platform === vendor));
  };
  useEffect(() => { load(); }, [entity, vendor]);

  const active = rows[0];

  const connect = async () => {
    if (!apiKey.trim()) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/integrations/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, vendor, kind, api_key: apiKey.trim() }) });
    const d = await r.json();
    if (d.ok) { setMsg("✓ connected"); setApiKey(""); setShowForm(false); await load(); }
    else setMsg("⚠ " + (d.error || "failed"));
    setBusy(false);
  };
  const retest = async (id: string) => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/integrations/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await r.json();
    setMsg(d.ok ? "✓ still connected" : "⚠ " + (d.error || "failed")); await load(); setBusy(false);
  };
  const revoke = async (id: string) => {
    if (!confirm(`Revoke ${label} for ${entity}? The stored key is soft-deleted, audit trail stays.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/integrations/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await r.json();
    setMsg(d.ok ? "✓ revoked" : "⚠ " + (d.error || "failed")); await load(); setBusy(false);
  };

  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="font-serif text-[15px] text-ink">{label}</p>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{vendor} · {kind}</p>
        </div>
        {active ? (
          <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${active.status === "connected" ? "border-basil/40 bg-basil/10 text-basil" : "border-tomato/40 bg-tomato/10 text-tomato"}`}>{active.status}</span>
        ) : (
          <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">not connected</span>
        )}
      </div>

      {active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => retest(active.id)} disabled={busy} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">↻ retest</button>
          <button onClick={() => setShowForm((v) => !v)} disabled={busy} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">↑ rotate key</button>
          <button onClick={() => revoke(active.id)} disabled={busy} className="rounded-full border border-tomato/40 bg-tomato/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-tomato hover:border-tomato">× revoke</button>
          {active.last_check_at ? <span className="font-mono text-[10px] text-muted">last check {new Date(active.last_check_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="mt-3 rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">connect →</button>
      )}

      {showForm ? (
        <div className="mt-3 rounded border border-line bg-paper-deep/40 p-3">
          <p className="font-serif italic text-[13px] text-ink-soft">{howto}</p>
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste API key" className="mt-2 w-full rounded border border-line bg-paper px-2 py-1.5 font-mono text-[12px]" />
          <div className="mt-2 flex gap-2">
            <button onClick={connect} disabled={busy || !apiKey.trim()} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">{busy ? "testing…" : "test + save"}</button>
            <button onClick={() => { setShowForm(false); setApiKey(""); setMsg(""); }} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink">cancel</button>
          </div>
        </div>
      ) : null}
      {msg ? <p className="mt-2 font-mono text-[10px] text-ink">{msg}</p> : null}
    </div>
  );
}
