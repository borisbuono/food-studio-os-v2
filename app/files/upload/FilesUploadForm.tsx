"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const CATEGORIES = [
  "haccp", "contract", "brand", "gestoria", "statement",
  "legal", "insurance", "certification", "menu_pdf", "other",
] as const;
type Category = typeof CATEGORIES[number];

// Client-side upload. Two steps:
//   1. Push binary into supabase storage bucket `documents` at
//      documents/<entity>/<category>/<yyyy-mm-dd>_<slug>.<ext>
//   2. Insert a row in files_documents with the storage path.
//
// The bucket must exist (see migration comment) — if it doesn't the storage
// call surfaces a clear error we render inline.
export default function FilesUploadForm({ entityCode }: { entityCode: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!file || !title.trim()) {
      setErr("Give it a title and pick a file.");
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const today = new Date().toISOString().slice(0, 10);
      const path = `${entityCode}/${category}/${today}_${slugify(title)}.${ext}`;
      const { error: upErr } = await supabaseBrowser.storage.from("documents").upload(path, file, { upsert: false });
      if (upErr) {
        // Common failure: bucket doesn't exist yet. Surface the raw text so
        // the operator can spot it (and re-run the storage-bucket SQL from
        // the migration comment).
        setErr("Storage upload failed: " + upErr.message);
        setBusy(false);
        return;
      }
      const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const { data: inserted, error: insErr } = await supabaseBrowser.from("files_documents").insert({
        entity_code: entityCode,
        category,
        title: title.trim(),
        description: description.trim() || null,
        file_url: path,
        file_bytes: file.size,
        mime_type: file.type || null,
        tags,
        uploaded_by: authData.user?.id || null,
        valid_until: validUntil || null,
      }).select("id").maybeSingle();
      if (insErr) {
        setErr("Row insert failed (storage upload succeeded): " + insErr.message);
        setBusy(false);
        return;
      }
      router.push(inserted?.id ? `/files/${inserted.id}` : "/files");
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      {err ? (
        <p className="border-l-2 border-tomato pl-3 font-mono text-[11px] uppercase tracking-wide text-tomato">
          {err}
        </p>
      ) : null}

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required
          className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif text-[18px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none"
          placeholder="e.g. May 2026 HACCP fridge log" />
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Category *</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} onClick={() => setCategory(c)}
              className={"rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition " + (category === c ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft")}>
              {c.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif text-[15px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none"
          placeholder="What is this? When was it created?" />
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Tags · comma-separated</label>
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)}
          className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif text-[15px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none"
          placeholder="e.g. bm, taller, insurance" />
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">
          Valid until · optional, we amber-badge within 30 days
        </label>
        <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
          className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif text-[15px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none" />
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">File *</label>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required
          className="mt-2 block w-full font-sans text-[13px] text-ink-soft file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:font-mono file:text-[10px] file:uppercase file:tracking-wide file:text-paper hover:file:opacity-80" />
        {file ? <p className="mt-1 font-mono text-[10px] text-clay">{file.name} · {(file.size / 1024).toFixed(0)} KB</p> : null}
      </div>

      <div className="flex items-center gap-3 pt-4">
        <button type="submit" disabled={busy}
          className="rounded-full border border-ink bg-ink px-5 py-2 font-mono text-[10px] uppercase tracking-wide text-paper transition disabled:opacity-40 hover:opacity-90">
          {busy ? "Uploading…" : "Upload to " + entityCode}
        </button>
        <a href="/files" className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">
          Cancel
        </a>
      </div>
    </form>
  );
}
