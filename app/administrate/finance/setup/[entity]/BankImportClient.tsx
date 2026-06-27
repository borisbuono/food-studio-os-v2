"use client";
import { useState } from "react";

export default function BankImportClient({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [bank, setBank] = useState<string>("CaixaBank");
  const onPick = async (file?: File | null) => {
    if (!file) return; setBusy(true); setMsg("");
    const fd = new FormData(); fd.append("file", file); fd.append("entity", code); fd.append("bank_account", bank);
    const r = await fetch("/api/finance/import-bank", { method: "POST", body: fd });
    const d = await r.json();
    setMsg(d.ok ? `✓ Imported ${d.inserted} movements into ${d.bank_account}` : "⚠ " + (d.error || "failed"));
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="font-serif text-[15px] text-ink">⬆ Import bank statement</p>
      <p className="mt-1 font-serif italic text-[13px] text-muted">CaixaBank CSV/XLSX export. Headers in Spanish or English.</p>
      <input className="mt-2 w-full rounded border border-line bg-paper-deep/40 px-2 py-1 font-mono text-[12px]" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="bank account label" />
      <input id={`bank-${code}`} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <label htmlFor={`bank-${code}`} className={`mt-2 inline-block cursor-pointer rounded border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${busy ? "opacity-60" : ""}`}>{busy ? "Importing…" : "pick file →"}</label>
      {msg ? <p className="mt-2 font-mono text-[11px] text-ink">{msg}</p> : null}
    </div>
  );
}
