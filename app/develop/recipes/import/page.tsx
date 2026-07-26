"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Recipe import surface — three ways to bring a recipe in:
//   1. Paste (chef notes, WhatsApp copy, anywhere)
//   2. Upload PDF / image (OCR via the parser)
//   3. Drive folder (stub — real OAuth follows)
//
// After parse, a side-by-side preview drawer shows raw text vs. structured
// output, with confidence chips per field and an editable form. Save writes
// a real recipe + ingredients + steps row.
//
// Editorial face: paper, ink, Fraunces headings. Chip precision stays
// tabular-num. Chef FAB can voice-drive "parse this" — see effect at bottom.

const CORPUS_FOLDER_ID = "1J3A704Hmmk9Ny9ePu6Z2ltMis18whtvT";

type Confidence = { title: number; yield: number; times: number; servings: number; ingredients: number; steps: number };
type Ingredient = { ingredient_name: string; quantity: number | null; unit: string | null; notes: string | null; is_optional: boolean; order_idx: number };
type Step = { order_idx: number; body: string; minutes: number | null; temperature_c: number | null };
type Parsed = {
  title: string;
  yield_grams: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  servings: number | null;
  difficulty: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  notes: string | null;
  language: "en" | "es" | "mixed";
  parser: "haiku" | "heuristic";
  confidence: Confidence;
};

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; sizeBytes: number | null };

export default function ImportPage() {
  const params = useSearchParams();
  const resumeId = params.get("resume");

  const [paste, setPaste] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [rawShown, setRawShown] = useState<string>("");
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);

  // Drive
  const [drive, setDrive] = useState<{ connected: boolean; stub: boolean; files: DriveFile[]; folder_id?: string } | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<any | null>(null);

  const pasteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!resumeId) return;
    // Load a parsed-but-not-yet-committed row from the imports log
    (async () => {
      try {
        const res = await fetch(`/api/recipes/import?resume=${resumeId}`, { method: "GET" });
        if (res.ok) {
          const j = await res.json();
          if (j.parsed) { setParsed(j.parsed); setImportId(resumeId); setRawShown(j.raw_content || ""); }
        }
      } catch {}
    })();
  }, [resumeId]);

  // Chef FAB voice hook — "parse this" reads clipboard and kicks off a parse.
  useEffect(() => {
    const handler = async (e: Event) => {
      const anyEvent = e as CustomEvent<{ text?: string }>;
      const t = anyEvent.detail?.text || "";
      if (!/parse\s+this|analizar|parsea esto/i.test(t)) return;
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim()) {
          setPaste(clip);
          setTimeout(() => runParse(clip), 30);
        }
      } catch {}
    };
    window.addEventListener("assistant:intent", handler as any);
    return () => window.removeEventListener("assistant:intent", handler as any);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runParse = async (raw?: string) => {
    const content = (raw ?? paste).trim();
    if (!content) { setError("Nothing to parse — paste a recipe first."); return; }
    setError(null); setParsing(true); setParsed(null); setSavedRecipeId(null);
    try {
      const res = await fetch("/api/recipes/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "paste", raw_content: content, commit: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.detail || j?.error || "Parse failed");
      setParsed(j.parsed);
      setImportId(j.import_id);
      setRawShown(content);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const runOcr = async (file: File) => {
    setError(null); setParsing(true); setParsed(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Reuse the ingest surface: we OCR client-side by base64ing the file
      // and letting the parser (vision-capable) read it. For now, if it's
      // a plain text/markdown file we can inline; for PDFs/images the
      // caller must have wired vision — degrade gracefully.
      if (file.type.startsWith("text/")) {
        const text = await file.text();
        setPaste(text);
        await runParse(text);
      } else {
        // Placeholder OCR path — real vision OCR wires up in a follow-up.
        const b64 = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ""));
          r.readAsDataURL(file);
        });
        const res = await fetch("/api/recipes/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "ocr_pdf", external_ref: file.name, raw_content: `[[binary attachment: ${file.name}, ${file.type}, ${file.size}b, base64 len=${b64.length}]]` }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.detail || j?.error || "OCR-parse failed");
        setParsed(j.parsed);
        setImportId(j.import_id);
        setRawShown(`(binary file: ${file.name})`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const commit = async () => {
    if (!parsed || !importId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/recipes/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "paste", raw_content: rawShown, parsed, commit: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.detail || j?.error || "Save failed");
      setSavedRecipeId(j.recipe_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const listDrive = async () => {
    setDriveBusy(true); setError(null);
    try {
      const res = await fetch("/api/recipes/drive/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder_id: CORPUS_FOLDER_ID }),
      });
      const j = await res.json();
      setDrive(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDriveBusy(false);
    }
  };

  const importAll = async () => {
    if (!drive || !drive.files.length) return;
    setDriveBusy(true); setError(null); setBatchResult(null);
    try {
      // For the stub, each file becomes a placeholder parse — the parser
      // heuristic will do what it can. Real path pulls file bytes first.
      const items = drive.files.map((f) => ({
        source: "drive_folder",
        external_ref: f.id,
        raw_content: `Title: ${f.name.replace(/\.[^.]+$/, "")}\n\n(Drive stub — real content follows in the next patch when the Drive client is wired.)`,
      }));
      const res = await fetch("/api/recipes/import/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, commit: false }),
      });
      const j = await res.json();
      setBatchResult(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-7 py-14 bg-paper">
      <div className="flex items-baseline justify-between">
        <div>
          <Link href="/develop/recipes" className="font-sans text-[13px] text-ink-soft">← The corpus</Link>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">Import</p>
          <h1 className="mt-2 font-serif text-5xl font-light leading-tight text-ink">Bring a recipe in</h1>
        </div>
      </div>
      <p className="mt-4 max-w-xl lg:max-w-4xl font-serif text-[19px] font-light italic leading-snug text-ink-soft">
        Paste it, drop a PDF, or connect the folder. The parser does the first pass; you finish the edit; the corpus grows.
      </p>

      {error ? (
        <div className="mt-8 border-l-2 border-tomato bg-paper-deep px-4 py-3">
          <p className="font-sans text-[13px] text-tomato">{error}</p>
        </div>
      ) : null}

      {/* --- Section 1: Paste --- */}
      <section className="mt-14 border-t border-line pt-10">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">1 · Paste</p>
        <h2 className="mt-2 font-serif text-[28px] font-light text-ink">Any recipe, any format</h2>
        <textarea
          ref={pasteRef}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste a recipe — English, Spanish, or a mix. WhatsApp notes, an OCR'd PDF, chef's shorthand: all fine."
          className="mt-4 w-full min-h-[220px] rounded-2xl border border-line bg-card px-5 py-4 font-serif text-[17px] leading-relaxed text-ink outline-none focus:border-ink"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => runParse()}
            disabled={parsing || !paste.trim()}
            className="rounded-full bg-ink px-5 py-2.5 font-sans text-[13px] font-medium text-paper transition hover:opacity-90 disabled:opacity-40"
          >
            {parsing ? "Parsing…" : "Parse this"}
          </button>
          {paste.trim() ? <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-clay tabular-nums">{paste.length} chars</span> : null}
        </div>
      </section>

      {/* --- Section 2: Upload --- */}
      <section className="mt-14 border-t border-line pt-10">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">2 · Upload</p>
        <h2 className="mt-2 font-serif text-[28px] font-light text-ink">PDF, image, or plain text</h2>
        <label className="mt-4 flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-line bg-card px-5 py-8 transition hover:border-ink">
          <input
            type="file"
            className="hidden"
            accept="application/pdf,image/*,text/*,.md,.docx"
            onChange={(e) => e.target.files?.[0] && runOcr(e.target.files[0])}
          />
          <span className="font-serif text-[17px] font-light italic text-ink-soft">Drop a file, or click to browse.</span>
        </label>
      </section>

      {/* --- Section 3: Drive --- */}
      <section className="mt-14 border-t border-line pt-10">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">3 · Google Drive</p>
        <h2 className="mt-2 font-serif text-[28px] font-light text-ink">Connect the corpus folder</h2>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">Boris's Recetas folder — every dish ever written, in one sweep.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={listDrive} disabled={driveBusy} className="rounded-full border border-ink px-5 py-2.5 font-sans text-[13px] font-medium text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40">
            {drive ? "Refresh list" : "Connect Google Drive"}
          </button>
          {drive && drive.files.length ? (
            <button onClick={importAll} disabled={driveBusy} className="rounded-full bg-tomato px-5 py-2.5 font-sans text-[13px] font-medium text-paper transition hover:opacity-90 disabled:opacity-40">
              {driveBusy ? "Working…" : `Import all (${drive.files.length})`}
            </button>
          ) : null}
        </div>
        {drive?.stub ? (
          <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">Stub connection — sample manifest. Real Drive OAuth follows in a next patch.</p>
        ) : null}
        {drive?.files?.length ? (
          <ul className="mt-6 divide-y divide-line">
            {drive.files.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-4 py-3">
                <span className="font-serif text-[17px] text-ink">{f.name}</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay tabular-nums">{f.mimeType.split("/").pop()}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {batchResult ? (
          <div className="mt-6 rounded-2xl border border-line bg-card px-5 py-4">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">Batch result</p>
            <p className="mt-2 font-sans text-[14px] text-ink tabular-nums">
              {batchResult.imported} imported · {batchResult.parsed} parsed for review · {batchResult.failed} failed
            </p>
          </div>
        ) : null}
      </section>

      {/* --- Preview drawer --- */}
      {parsed ? (
        <PreviewDrawer
          raw={rawShown}
          parsed={parsed}
          onChange={setParsed}
          onCommit={commit}
          saving={saving}
          savedRecipeId={savedRecipeId}
          onClose={() => { setParsed(null); setSavedRecipeId(null); }}
        />
      ) : null}
    </main>
  );
}

function ConfChip({ label, value }: { label: string; value: number }) {
  const tone = value >= 0.75 ? "text-basil" : value >= 0.5 ? "text-ochre" : "text-tomato";
  return (
    <span className={"mr-2 inline-flex items-baseline gap-1 font-mono text-[10.5px] uppercase tracking-[0.18em] " + tone}>
      <span>{label}</span>
      <span className="tabular-nums">{Math.round(value * 100)}</span>
    </span>
  );
}

function PreviewDrawer({ raw, parsed, onChange, onCommit, saving, savedRecipeId, onClose }: {
  raw: string;
  parsed: Parsed;
  onChange: (p: Parsed) => void;
  onCommit: () => void;
  saving: boolean;
  savedRecipeId: string | null;
  onClose: () => void;
}) {
  const set = <K extends keyof Parsed>(k: K, v: Parsed[K]) => onChange({ ...parsed, [k]: v });

  const setIng = (idx: number, patch: Partial<Ingredient>) => {
    const next = parsed.ingredients.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...parsed, ingredients: next });
  };
  const setStep = (idx: number, patch: Partial<Step>) => {
    const next = parsed.steps.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...parsed, steps: next });
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-hidden rounded-t-3xl border-t border-line bg-paper shadow-2xl">
      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl overflow-y-auto px-7 py-8" style={{ maxHeight: "80vh" }}>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-tomato">Preview · {parsed.parser} · {parsed.language}</p>
            <h2 className="mt-1 font-serif text-[32px] font-light leading-tight text-ink">Ready to review</h2>
          </div>
          <button onClick={onClose} className="font-mono text-[11px] uppercase tracking-[0.2em] text-clay">Close</button>
        </div>

        <div className="mt-4">
          <ConfChip label="title" value={parsed.confidence.title} />
          <ConfChip label="ings" value={parsed.confidence.ingredients} />
          <ConfChip label="steps" value={parsed.confidence.steps} />
          <ConfChip label="yield" value={parsed.confidence.yield} />
          <ConfChip label="times" value={parsed.confidence.times} />
          <ConfChip label="servings" value={parsed.confidence.servings} />
        </div>

        {savedRecipeId ? (
          <div className="mt-6 border-l-2 border-basil bg-paper-deep px-4 py-3">
            <p className="font-serif text-[17px] text-ink">Saved. <Link href={`/develop/menu/${savedRecipeId}`} className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em] text-tomato">Open the recipe →</Link></p>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Raw */}
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Raw</p>
            <pre className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-line bg-card p-4 font-mono text-[12px] leading-relaxed text-ink-soft">{raw || "(binary)"}</pre>
          </div>

          {/* Editable structure */}
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Structured</p>
            <div className="mt-3 space-y-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Title</span>
                <input value={parsed.title} onChange={(e) => set("title", e.target.value)} className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-serif text-[18px] text-ink outline-none focus:border-ink" />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Servings</span>
                  <input value={parsed.servings ?? ""} onChange={(e) => set("servings", e.target.value ? Number(e.target.value) : null)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink tabular-nums outline-none focus:border-ink" />
                </label>
                <label>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Prep min</span>
                  <input value={parsed.prep_minutes ?? ""} onChange={(e) => set("prep_minutes", e.target.value ? Number(e.target.value) : null)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink tabular-nums outline-none focus:border-ink" />
                </label>
                <label>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Cook min</span>
                  <input value={parsed.cook_minutes ?? ""} onChange={(e) => set("cook_minutes", e.target.value ? Number(e.target.value) : null)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink tabular-nums outline-none focus:border-ink" />
                </label>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Ingredients</p>
                <div className="mt-2 max-h-[28vh] overflow-y-auto divide-y divide-line rounded-lg border border-line bg-card">
                  {parsed.ingredients.map((i, idx) => (
                    <div key={idx} className="flex items-baseline gap-2 px-3 py-2">
                      <input value={i.quantity ?? ""} onChange={(e) => setIng(idx, { quantity: e.target.value ? Number(e.target.value) : null })} placeholder="qty" className="w-14 rounded border border-black/10 bg-paper px-2 py-1 font-sans text-[13px] tabular-nums" />
                      <input value={i.unit ?? ""} onChange={(e) => setIng(idx, { unit: e.target.value || null })} placeholder="unit" className="w-14 rounded border border-black/10 bg-paper px-2 py-1 font-sans text-[13px]" />
                      <input value={i.ingredient_name} onChange={(e) => setIng(idx, { ingredient_name: e.target.value })} className="flex-1 rounded border border-black/10 bg-paper px-2 py-1 font-serif text-[15px] text-ink" />
                    </div>
                  ))}
                  {!parsed.ingredients.length ? <p className="px-3 py-2 font-serif text-[15px] italic text-ink-soft">No ingredients detected.</p> : null}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Steps</p>
                <div className="mt-2 max-h-[28vh] space-y-2 overflow-y-auto rounded-lg border border-line bg-card p-3">
                  {parsed.steps.map((s, idx) => (
                    <textarea key={idx} value={s.body} onChange={(e) => setStep(idx, { body: e.target.value })} className="w-full rounded border border-black/10 bg-paper px-2 py-1 font-serif text-[15px] leading-relaxed text-ink" rows={2} />
                  ))}
                  {!parsed.steps.length ? <p className="font-serif text-[15px] italic text-ink-soft">No method detected.</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-line bg-paper py-4">
          <button onClick={onCommit} disabled={saving || !!savedRecipeId} className="rounded-full bg-ink px-6 py-2.5 font-sans text-[13px] font-medium text-paper transition hover:opacity-90 disabled:opacity-40">
            {saving ? "Saving…" : savedRecipeId ? "Saved" : "Save as recipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
