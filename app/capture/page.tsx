"use client";
import { useState } from "react";
import Link from "next/link";

type DocType = "invoice" | "albaran" | "eod" | "other";

const TYPES: { key: DocType; label: string; helper: string }[] = [
  { key: "invoice", label: "Invoice",       helper: "Lands in /administrate/finance/scans for triage + approval." },
  { key: "albaran", label: "Delivery note", helper: "Lands in /execute/receiving — matches the open order if any." },
  { key: "eod",     label: "EOD report",    helper: "Lands in /administrate/finance/eod — manual entry after the photo." },
  { key: "other",   label: "Other",         helper: "Lands in invoice inbox with a note." },
];

export default function Capture() {
  const [type, setType] = useState<DocType>("invoice");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [link, setLink] = useState<string>("");

  const onPick = async (file?: File | null) => {
    if (!file) return; setBusy(true); setMsg(""); setLink("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", type);
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setMsg("⚠ " + (d.error || "Upload failed")); setBusy(false); return; }
      setMsg(`✓ Filed as ${d.type} — ${d.where}`);
      setLink(d.next || "");
    } catch (e: any) { setMsg("⚠ " + (e?.message || "Upload failed")); }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <Link href="/administrate/finance/dashboard" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
      <h1 className="mt-3 font-serif text-[34px] leading-[1.05] text-ink">Capture</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Snap a paper invoice, delivery note, or EOD slip. The OS files it in the right place.</p>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">What is this?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {TYPES.map((t) => (
          <button key={t.key} onClick={() => setType(t.key)} className={`rounded-xl border px-4 py-3 text-left ${type === t.key ? "border-ink bg-paper-deep" : "border-line bg-paper"}`}>
            <span className="font-serif text-[15px] text-ink">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 font-serif italic text-[13px] text-muted">{TYPES.find((t) => t.key === type)?.helper}</p>

      <input id="cap-photo" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <label htmlFor="cap-photo" className={`mt-8 block cursor-pointer rounded-2xl border border-ink bg-ink px-6 py-5 text-center font-mono text-[12px] uppercase tracking-wide text-paper ${busy ? "opacity-60" : ""}`}>
        {busy ? "Uploading…" : "📷 Open camera"}
      </label>

      {msg ? <p className="mt-5 font-mono text-[12px] text-ink">{msg}</p> : null}
      {link ? <Link href={link} className="mt-2 inline-block font-mono text-[11px] uppercase tracking-wide text-clay underline">→ go to filing place</Link> : null}

      <div className="mt-12 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">After tonight: this button</p>
        <p className="mt-2 font-serif italic text-[13px] text-ink-soft">…also lives in the Chef FAB once that's tuned. For now it's a standalone surface so the backlog can flow in.</p>
      </div>
    </main>
  );
}
