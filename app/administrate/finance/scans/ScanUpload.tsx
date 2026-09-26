"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Drop scanned PDFs (or photos). Each file is captured on its own; the entity
// is read off the paper, not from the venue you're in.
type Res = { name: string; ok: boolean; line: string };

export default function ScanUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res[]>([]);

  async function run(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setRes([]);
    const out: Res[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f); fd.append("filename", f.name); fd.append("source", "manual_upload");
      try {
        const r = await fetch("/api/capture", { method: "POST", body: fd });
        const j = await r.json();
        if (!j.ok) out.push({ name: f.name, ok: false, line: j.error || "failed" });
        else if (j.status === "filed" || j.status === "needs_triage" || j.status === "rejected")
          out.push({ name: f.name, ok: j.status === "filed", line: `${j.status.replace("_", " ")} · ${j.entity} (${j.entity_source.replace("_", " ")}) · ${j.doc_type} · ${j.lines} lines${j.flags?.length ? " · " + j.flags.join(", ") : ""}` });
        else out.push({ name: f.name, ok: j.status !== "conflicting_copies", line: j.status.replace(/_/g, " ") + (j.reason ? " · " + j.reason : j.status === "conflicting_copies" ? ` · kept ${j.prior_total} vs this ${j.this_total}` : "") });
      } catch (e: any) { out.push({ name: f.name, ok: false, line: String(e?.message || e) }); }
      setRes([...out]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-6 rounded-xl border border-dashed border-line p-4">
      <label className="block cursor-pointer font-mono text-[11px] uppercase tracking-wide text-ink">
        {busy ? `Reading ${res.length + 1}…` : "Add scans (PDF / photo)"}
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => run(e.target.files)} />
      </label>
      {res.length ? (
        <ul className="mt-2 space-y-1">
          {res.map((r, i) => <li key={i} className={"font-mono text-[11px] " + (r.ok ? "text-ink-soft" : "text-tomato")}>{r.name} — {r.line}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
