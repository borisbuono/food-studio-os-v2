"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AssistantContext from "@/components/AssistantContext";

type FileRow = {
  id: string;
  entity_code: string;
  category: string;
  title: string;
  description: string | null;
  file_url: string;
  file_bytes: number | null;
  mime_type: string | null;
  tags: string[] | null;
  uploaded_by: string | null;
  uploaded_at: string;
  valid_until: string | null;
  archived_at: string | null;
};

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  try {
    const then = new Date(s).getTime();
    const now = new Date().getTime();
    return Math.round((then - now) / (24 * 3600 * 1000));
  } catch { return null; }
}

export default function FileDetailClient({ doc }: { doc: FileRow }) {
  const router = useRouter();
  const [tagsText, setTagsText] = useState((doc.tags || []).join(", "));
  const [savingTags, setSavingTags] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dLeft = daysUntil(doc.valid_until);
  const expiring = dLeft !== null && dLeft >= 0 && dLeft <= 30;
  const expired = dLeft !== null && dLeft < 0;

  // Ask Supabase Storage for a short-lived signed URL for download. If the
  // bucket doesn't exist yet or the RLS policy is missing we surface the raw
  // error so the operator can spot it.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabaseBrowser.storage.from("documents").createSignedUrl(doc.file_url, 60 * 30);
        if (!live) return;
        if (error) { setDownloadErr(error.message); return; }
        setDownloadUrl(data?.signedUrl || null);
      } catch (e: any) {
        if (live) setDownloadErr(e?.message || "download URL failed");
      }
    })();
    return () => { live = false; };
  }, [doc.file_url]);

  async function saveTags() {
    setSavingTags(true);
    setError(null);
    try {
      const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
      const { error } = await supabaseBrowser.from("files_documents").update({ tags }).eq("id", doc.id);
      if (error) setError(error.message);
      else router.refresh();
    } finally {
      setSavingTags(false);
    }
  }

  async function archive() {
    if (!confirm("Archive this file? It will hide from the list; you can restore later.")) return;
    setArchiving(true);
    setError(null);
    try {
      const { error } = await supabaseBrowser.from("files_documents").update({ archived_at: new Date().toISOString() }).eq("id", doc.id);
      if (error) { setError(error.message); setArchiving(false); return; }
      router.push("/files");
    } catch (e: any) {
      setError(e?.message || "archive failed");
      setArchiving(false);
    }
  }

  return (
    <>
      <AssistantContext context={{ kind: "file", id: doc.id, title: doc.title, category: doc.category, entity: doc.entity_code, tags: doc.tags, valid_until: doc.valid_until, expiring, expired }} />

      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
        {doc.category.replace("_", " ")} · {doc.entity_code}
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">{doc.title}</h1>
      {doc.description ? (
        <p className="mt-2 font-serif italic text-[15px] text-ink-soft">{doc.description}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {expiring ? (
          <span className="rounded-full border border-amber/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber">expires in {dLeft}d</span>
        ) : null}
        {expired ? (
          <span className="rounded-full border border-tomato/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tomato">expired</span>
        ) : null}
        {doc.archived_at ? (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">archived</span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 border-l-2 border-tomato pl-3 font-mono text-[10px] uppercase tracking-wide text-tomato">{error}</p>
      ) : null}

      {/* Metadata */}
      <section className="mt-8 border-t border-line pt-4">
        <dl className="grid grid-cols-2 gap-y-2 font-sans text-[13px]">
          <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Uploaded</dt>
          <dd className="text-ink">{fmtDate(doc.uploaded_at)}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Size</dt>
          <dd className="text-ink">{fmtBytes(doc.file_bytes)}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Type</dt>
          <dd className="text-ink">{doc.mime_type || "—"}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Valid until</dt>
          <dd className="text-ink">{fmtDate(doc.valid_until)}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wide text-clay">Storage path</dt>
          <dd className="font-mono text-[11px] text-ink-soft break-all">{doc.file_url}</dd>
        </dl>
      </section>

      {/* Download */}
      <section className="mt-6 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Download</p>
        {downloadErr ? (
          <p className="mt-2 border-l-2 border-tomato pl-3 font-mono text-[10px] uppercase tracking-wide text-tomato">
            {downloadErr}
          </p>
        ) : downloadUrl ? (
          <a href={downloadUrl} target="_blank" rel="noreferrer"
             className="mt-2 inline-block rounded-full border border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper">
            Open document →
          </a>
        ) : (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">preparing signed URL…</p>
        )}
      </section>

      {/* Tags edit */}
      <section className="mt-6 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Tags · comma-separated</p>
        <div className="mt-2 flex items-center gap-2">
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)}
            className="w-full border-b border-line bg-transparent py-2 font-serif text-[15px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none" />
          <button onClick={saveTags} disabled={savingTags}
            className="rounded-full border border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper disabled:opacity-40">
            {savingTags ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {/* Archive */}
      {!doc.archived_at ? (
        <section className="mt-8 border-t border-line pt-4">
          <button onClick={archive} disabled={archiving}
            className="font-mono text-[10px] uppercase tracking-wide text-tomato hover:underline disabled:opacity-40">
            {archiving ? "Archiving…" : "Archive this file →"}
          </button>
        </section>
      ) : null}
    </>
  );
}
