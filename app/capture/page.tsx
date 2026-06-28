"use client";
import FabHidden from "@/components/FabHidden";
import { useState } from "react";
import Link from "next/link";

type DocType = "auto" | "invoice" | "albaran" | "eod" | "other";

const LABELS: Record<DocType, string> = { auto: "Auto-detect", invoice: "Invoice", albaran: "Delivery note", eod: "EOD report", other: "Other" };

export default function Capture() {
  const [type, setType] = useState<DocType>("auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [detected, setDetected] = useState<any>(null);

  const onPick = async (file?: File | null) => {
    if (!file) return; setBusy(true); setMsg(""); setLink(""); setDetected(null);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", type);
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setMsg("⚠ " + (d.error || "Upload failed")); setBusy(false); return; }
      setMsg(`✓ Filed as ${d.type} — ${d.where}`);
      setLink(d.next || "");
      if (d.detected) setDetected(d.detected);
    } catch (e: any) { setMsg("⚠ " + (e?.message || "Upload failed")); }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-md px-6 py-10"><FabHidden />
      <Link href="/administrate/finance/dashboard" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
      <h1 className="mt-3 font-serif text-[34px] leading-[1.05] text-ink">Capture</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Snap a paper invoice, delivery note, or EOD slip. Default is auto-detect — the OS reads the photo and files it.</p>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Filing</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(["auto","invoice","albaran","eod","other"] as DocType[]).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`rounded-xl border px-3 py-2 text-left ${type === t ? "border-ink bg-paper-deep" : "border-line bg-paper"}`}>
            <span className="font-serif text-[14px] text-ink">{LABELS[t]}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 font-serif italic text-[13px] text-muted">{type === "auto" ? "Claude vision classifies the document, extracts supplier + total + VAT + date." : "Override the auto-detect — the file lands in the chosen table."}</p>

      <input id="cap-photo" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <label htmlFor="cap-photo" className={`mt-8 block cursor-pointer rounded-2xl border border-ink bg-ink px-6 py-5 text-center font-mono text-[12px] uppercase tracking-wide text-paper ${busy ? "opacity-60" : ""}`}>
        {busy ? "Uploading + classifying…" : "📷 Open camera"}
      </label>

      {msg ? <p className="mt-5 font-mono text-[12px] text-ink">{msg}</p> : null}
      {detected ? (
        <div className="mt-3 rounded-xl border border-line bg-paper-deep/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Detected</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-serif text-[13px]">
            <dt className="text-muted">type</dt><dd className="text-ink">{detected.type}</dd>
            {detected.supplier_name ? (<><dt className="text-muted">supplier</dt><dd className="text-ink">{detected.supplier_name}</dd></>) : null}
            {detected.total_eur != null ? (<><dt className="text-muted">total</dt><dd className="text-ink">€{Number(detected.total_eur).toFixed(2)}</dd></>) : null}
            {detected.vat_eur != null ? (<><dt className="text-muted">vat</dt><dd className="text-ink">€{Number(detected.vat_eur).toFixed(2)}</dd></>) : null}
            {detected.document_date ? (<><dt className="text-muted">date</dt><dd className="text-ink">{detected.document_date}</dd></>) : null}
            {detected.confidence != null ? (<><dt className="text-muted">conf</dt><dd className="text-ink">{Math.round(detected.confidence * 100)}%</dd></>) : null}
          </dl>
          {detected.reasoning ? <p className="mt-2 font-serif italic text-[12px] text-muted">{detected.reasoning}</p> : null}
        </div>
      ) : null}
      {link ? <Link href={link} className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wide text-clay underline">→ open the filed item</Link> : null}
    </main>
  );
}
