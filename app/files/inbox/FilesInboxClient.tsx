"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AssistantContext from "@/components/AssistantContext";

// Categories the library accepts — matches files_documents.category.
const LIBRARY_CATEGORIES = [
  "haccp","contract","brand","gestoria","statement",
  "legal","insurance","certification","menu_pdf","other",
] as const;
type LibraryCategory = typeof LIBRARY_CATEGORIES[number];

// Categories the classifier can suggest (superset — includes modelo/photo
// which map to gestoria/brand at filing time).
const INBOX_SUGGESTED = [
  "contract","statement","modelo","haccp","insurance",
  "certification","menu_pdf","photo","other",
] as const;

// Map suggested (inbox) category → library category. Mirrors the server-side
// mapper in lib/files/classifier.ts.
function libraryCategoryFor(inboxCategory: string | null): LibraryCategory {
  switch (inboxCategory) {
    case "contract":      return "contract";
    case "statement":     return "statement";
    case "modelo":        return "gestoria";
    case "haccp":         return "haccp";
    case "insurance":     return "insurance";
    case "certification": return "certification";
    case "menu_pdf":      return "menu_pdf";
    case "photo":         return "brand";
    default:              return "other";
  }
}

export type InboxRow = {
  id: string;
  source: string;
  source_ref: string | null;
  sender: string | null;
  subject: string | null;
  received_at: string;
  file_url: string;
  file_bytes: number | null;
  mime_type: string | null;
  thumbnail_url: string | null;
  suggested_category: string | null;
  suggested_entity: string | null;
  suggested_title: string | null;
  suggested_valid_until: string | null;
  classification_confidence: number | null;
  classification_rationale: string | null;
  status: "pending_classify" | "classified" | "needs_triage" | "filed" | "rejected";
  filed_document_id: string | null;
  created_at: string;
  triaged_at: string | null;
  triaged_by: string | null;
};

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return s; }
}
function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function sourceLabel(source: string): string {
  if (source === "gmail_admin_bm") return "Gmail · admin@bistro-mondo";
  if (source === "gmail_admin_ifl") return "Gmail · admin@ibzfoodstudio";
  if (source === "gmail_admin_bbh") return "Gmail · admin@holdings";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "chef_fab_upload") return "Chef FAB · photo";
  if (source === "manual") return "Manual upload";
  return source;
}

// Confidence chip — green ≥ 0.85, amber 0.65..0.85, red < 0.65.
function ConfidenceChip({ value }: { value: number | null }) {
  const c = typeof value === "number" ? value : 0;
  const label = `${Math.round(c * 100)}%`;
  let color: string;
  if (c >= 0.85) color = "border-olive/50 text-olive";
  else if (c >= 0.65) color = "border-amber/50 text-amber";
  else color = "border-tomato/50 text-tomato";
  return (
    <span className={"inline-flex items-center rounded-full border px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide " + color}>
      {label} conf
    </span>
  );
}

// One card in the "Needs triage" list — has the full edit-in-place flow.
function TriageCard({
  row,
  entityCode,
  selected,
  onToggleSelect,
  onRefresh,
}: {
  row: InboxRow;
  entityCode: string;
  selected: boolean;
  onToggleSelect: (id: string, on: boolean) => void;
  onRefresh: () => void;
}) {
  const [category, setCategory] = useState<LibraryCategory>(libraryCategoryFor(row.suggested_category));
  const [entity, setEntity] = useState<"IFL"|"BM"|"BBH">(
    (row.suggested_entity as any) || (entityCode as any) || "IFL",
  );
  const [title, setTitle] = useState<string>(row.suggested_title || "");
  const [validUntil, setValidUntil] = useState<string>(row.suggested_valid_until || "");
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(row.thumbnail_url);

  // Lazily fetch a signed preview URL for the object so the browser can
  // render a thumbnail without loading the full 3MB PDF on the list page.
  async function loadThumb() {
    if (thumbUrl) return;
    try {
      // We ask our own storage-signed-url helper — falling back to raw path
      // if we can't sign (dev environments).
      const key = row.file_url.startsWith("documents-inbox/")
        ? row.file_url.slice("documents-inbox/".length)
        : row.file_url;
      const { supabaseBrowser } = await import("@/lib/supabaseBrowser");
      const { data } = await supabaseBrowser.storage.from("documents-inbox").createSignedUrl(key, 300);
      if (data?.signedUrl) setThumbUrl(data.signedUrl);
    } catch { /* ignore — the placeholder stays */ }
  }
  // Kick a load once on mount.
  if (typeof window !== "undefined" && !thumbUrl) { loadThumb(); }

  async function fileIt() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/files/inbox/${row.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity,
          category,
          title: title.trim() || "Untitled",
          valid_until: validUntil || null,
        }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "file failed");
      onRefresh();
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/files/inbox/${row.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "not a document" }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "reject failed");
      onRefresh();
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isImage = (row.mime_type || "").startsWith("image/");
  const isPdf = row.mime_type === "application/pdf";

  return (
    <article className="border-t border-line py-5">
      <div className="flex gap-4">
        {/* Selection */}
        <div className="flex-shrink-0 pt-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect(row.id, e.target.checked)}
            aria-label={`Select ${title || "attachment"}`}
            className="h-4 w-4 rounded border-line accent-ink"
          />
        </div>

        {/* Thumbnail */}
        <a
          href={thumbUrl || "#"}
          target="_blank" rel="noreferrer"
          className="flex h-24 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-paper text-clay"
          onClick={(e) => { if (!thumbUrl) e.preventDefault(); }}
          title={thumbUrl ? "Open full attachment" : "Preview loading…"}
        >
          {thumbUrl && isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-wide">
              {isPdf ? "PDF" : isImage ? "IMG" : (row.mime_type || "?").split("/").pop()?.toUpperCase()?.slice(0, 4) || "FILE"}
            </span>
          )}
        </a>

        <div className="min-w-0 flex-1">
          {/* Provenance + confidence */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{sourceLabel(row.source)}</span>
            <span className="font-mono text-[10px] text-clay">·</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{fmtDateTime(row.received_at)}</span>
            <ConfidenceChip value={row.classification_confidence} />
          </div>

          {/* Sender */}
          {row.sender ? (
            <p className="mt-0.5 font-mono text-[10px] text-clay truncate">
              from {row.sender}{row.subject ? ` · ${row.subject}` : ""}
            </p>
          ) : null}

          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="mt-2 w-full border-b border-line bg-transparent pb-1 font-serif text-[18px] text-ink placeholder:text-clay focus:border-ink focus:outline-none"
          />

          {/* Chips row: entity + category + valid_until */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">entity</span>
              <select
                value={entity}
                onChange={(e) => setEntity(e.target.value as any)}
                className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink"
              >
                <option value="IFL">IFL</option>
                <option value="BM">BM</option>
                <option value="BBH">BBH</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as LibraryCategory)}
                className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink"
              >
                {LIBRARY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace("_", " ")}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">expires</span>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink"
              />
            </label>
          </div>

          {/* Rationale drawer */}
          {row.classification_rationale ? (
            <button
              onClick={() => setRationaleOpen((v) => !v)}
              className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
              type="button"
            >
              {rationaleOpen ? "− why" : "+ why"}
            </button>
          ) : null}
          {rationaleOpen && row.classification_rationale ? (
            <p className="mt-1 border-l-2 border-line pl-3 font-serif italic text-[13px] text-ink-soft">
              {row.classification_rationale}
            </p>
          ) : null}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              disabled={busy}
              onClick={fileIt}
              className="rounded-full border border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper transition hover:opacity-90 disabled:opacity-40"
              type="button"
            >
              {busy ? "…" : "File"}
            </button>
            <a
              href={thumbUrl || "#"}
              target="_blank" rel="noreferrer"
              className={"rounded-full border border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink " + (thumbUrl ? "" : "pointer-events-none opacity-40")}
            >
              Open
            </a>
            <button
              disabled={busy}
              onClick={reject}
              className="rounded-full border border-tomato/60 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-tomato hover:bg-tomato hover:text-paper disabled:opacity-40"
              type="button"
            >
              Reject
            </button>
            <span className="font-mono text-[10px] text-clay">{fmtBytes(row.file_bytes)} · {row.mime_type || "?"}</span>
          </div>

          {err ? (
            <p className="mt-2 border-l-2 border-tomato pl-3 font-mono text-[10px] uppercase tracking-wide text-tomato">{err}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// Compact row for the collapsed lists (pending / filed / rejected).
function CompactRow({ row }: { row: InboxRow }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-t border-line py-2 font-serif text-[14px] text-ink-soft">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay mr-2">
          {sourceLabel(row.source)}
        </span>
        <span className="truncate">{row.suggested_title || row.subject || "Untitled"}</span>
      </div>
      <div className="flex-shrink-0 font-mono text-[10px] text-clay">
        {row.status === "filed" && row.filed_document_id ? (
          <Link href={`/files/${row.filed_document_id}`} className="hover:text-ink underline underline-offset-2 decoration-black/20">
            filed · {fmtDate(row.triaged_at || row.received_at)}
          </Link>
        ) : (
          <span>{row.status} · {fmtDate(row.received_at)}</span>
        )}
      </div>
    </li>
  );
}

export default function FilesInboxClient({
  rows, entityCode, entityLabel,
}: { rows: InboxRow[]; entityCode: string; entityLabel: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  const groups = useMemo(() => {
    const needsTriage = rows.filter((r) => r.status === "needs_triage" || r.status === "classified");
    const pending = rows.filter((r) => r.status === "pending_classify");
    const filed = rows.filter((r) => r.status === "filed").slice(0, 20);
    const rejected = rows.filter((r) => r.status === "rejected").slice(0, 20);
    return { needsTriage, pending, filed, rejected };
  }, [rows]);

  const onToggleSelect = (id: string, on: boolean) => {
    setSelected((prev) => ({ ...prev, [id]: on }));
  };
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const refresh = () => router.refresh();

  async function bulkFile() {
    setBulkBusy(true);
    try {
      const ids = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
      for (const id of ids) {
        // Fire-and-catch — one failure shouldn't block the rest.
        try {
          await fetch(`/api/files/inbox/${id}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          });
        } catch { /* skip */ }
      }
      setSelected({});
      refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <AssistantContext context={{
        kind: "files_inbox",
        entity: entityCode,
        counts: {
          needs_triage: groups.needsTriage.length,
          pending_classify: groups.pending.length,
          filed_recent: groups.filed.length,
          rejected_recent: groups.rejected.length,
        },
        selected: selectedCount,
      }} />

      {/* --- Needs triage ------------------------------------------------- */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl text-ink">
            Needs triage
            <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-clay">
              {groups.needsTriage.length}{groups.needsTriage.length === 1 ? " row" : " rows"}
            </span>
          </h2>
          {selectedCount > 0 ? (
            <button
              disabled={bulkBusy}
              onClick={bulkFile}
              className="rounded-full border border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper transition hover:opacity-90 disabled:opacity-40"
            >
              {bulkBusy ? "…" : `File selected (${selectedCount})`}
            </button>
          ) : null}
        </div>

        {groups.needsTriage.length === 0 ? (
          <div className="mt-4 border-t border-line py-10 text-center">
            <p className="font-serif italic text-[15px] text-ink-soft">
              Inbox is empty for {entityLabel}.
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
              Attachments from admin@bistro-mondo and admin@ibzfoodstudio auto-arrive here for classification.
            </p>
          </div>
        ) : (
          groups.needsTriage.map((r) => (
            <TriageCard
              key={r.id}
              row={r}
              entityCode={entityCode}
              selected={!!selected[r.id]}
              onToggleSelect={onToggleSelect}
              onRefresh={refresh}
            />
          ))
        )}
      </section>

      {/* --- Pending classify --------------------------------------------- */}
      {groups.pending.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">
            Pending classify · {groups.pending.length}
          </h2>
          <ul className="mt-2">
            {groups.pending.map((r) => <CompactRow key={r.id} row={r} />)}
          </ul>
        </section>
      ) : null}

      {/* --- Recently filed ---------------------------------------------- */}
      {groups.filed.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">
            Recently filed
          </h2>
          <ul className="mt-2">
            {groups.filed.map((r) => <CompactRow key={r.id} row={r} />)}
          </ul>
        </section>
      ) : null}

      {/* --- Rejected (collapsed by default) ------------------------------ */}
      {groups.rejected.length > 0 ? (
        <section className="mt-10">
          <button
            onClick={() => setShowRejected((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
            type="button"
          >
            {showRejected ? "− " : "+ "} Rejected · {groups.rejected.length}
          </button>
          {showRejected ? (
            <ul className="mt-2">
              {groups.rejected.map((r) => <CompactRow key={r.id} row={r} />)}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
