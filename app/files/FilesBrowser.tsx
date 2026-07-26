"use client";
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import AssistantContext from "@/components/AssistantContext";

const CATEGORIES = [
  "haccp", "contract", "brand", "gestoria", "statement",
  "legal", "insurance", "certification", "menu_pdf", "other",
] as const;
type Category = typeof CATEGORIES[number];

type FileRow = {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  file_bytes: number | null;
  mime_type: string | null;
  tags: string[] | null;
  uploaded_at: string;
  uploaded_by: string | null;
  valid_until: string | null;
  entity_code: string;
};

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
}
function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  try {
    const then = new Date(s).getTime();
    const now = new Date().getTime();
    return Math.round((then - now) / (24 * 3600 * 1000));
  } catch { return null; }
}
function fmtBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// The client-side filter/search UI for the Files landing. Chips + a table.
// Filter changes push into ?q= and ?category= so the URL is shareable and
// the browser back button works.
export default function FilesBrowser({
  rows, q, category, entityCode, error,
}: {
  rows: FileRow[];
  q: string;
  category: string;
  entityCode: string;
  error: string | null;
}) {
  const [term, setTerm] = useState(q || "");
  const [cat, setCat] = useState<string>(category || "");

  // Pushes filter state into the URL. `router.replace` would need next/router
  // hooks — instead we use history.replaceState so the SSR page can pick it
  // up on refresh. The listing itself is the SSR result; changing filters
  // just triggers a fresh navigation.
  function apply(nextTerm: string, nextCat: string) {
    const url = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost/files");
    if (nextTerm) url.searchParams.set("q", nextTerm); else url.searchParams.delete("q");
    if (nextCat)  url.searchParams.set("category", nextCat); else url.searchParams.delete("category");
    window.location.href = url.pathname + url.search;
  }

  const soon = useMemo(() =>
    rows.filter((r) => {
      const d = daysUntil(r.valid_until);
      return d !== null && d >= 0 && d <= 30;
    }).length, [rows]);

  return (
    <>
      {/* Assistant context — FAB knows what's on screen */}
      <AssistantContext context={{ kind: "files", entity: entityCode, filter: { q: term, category: cat }, count: rows.length, expiring_soon: soon }} />

      {error ? (
        <p className="mt-4 border-l-2 border-tomato pl-3 font-mono text-[10px] uppercase tracking-wide text-tomato">
          {error}
        </p>
      ) : null}

      {/* Search */}
      <div className="mt-6 flex items-center gap-2">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(term, cat); }}
          placeholder="Search titles + descriptions"
          className="w-full rounded-full border border-black/15 px-4 py-2 font-sans text-[13px] text-ink placeholder:text-clay focus:border-ink/40 focus:outline-none"
        />
        <button
          onClick={() => apply(term, cat)}
          className="rounded-full border border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper"
        >
          Search
        </button>
      </div>

      {/* Category chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => { setCat(""); apply(term, ""); }}
          className={"rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition " + (cat === "" ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft")}
        >
          all
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCat(c); apply(term, c); }}
            className={"rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition " + (cat === c ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft")}
          >
            {c.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Table */}
      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          {rows.length} document{rows.length === 1 ? "" : "s"}{cat ? ` · ${cat}` : ""}{q ? ` · matching "${q}"` : ""}{soon ? ` · ${soon} expiring within 30d` : ""}
        </p>
        {rows.length === 0 ? (
          <div className="mt-6 border-t border-line py-10 text-center">
            <p className="font-serif italic text-[15px] text-ink-soft">
              No documents{cat ? ` under "${cat.replace("_", " ")}"` : ""} yet.
            </p>
            <span className="mt-4 inline-block rounded-full border border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-clay">Ask Chef to file a photo — tap the Chef button and describe it</span>
          </div>
        ) : (
          <ul className="mt-3">
            {rows.map((r) => {
              const dLeft = daysUntil(r.valid_until);
              const expiring = dLeft !== null && dLeft >= 0 && dLeft <= 30;
              const expired = dLeft !== null && dLeft < 0;
              return (
                <li key={r.id} className="border-t border-line py-4">
                  <Link href={`/files/${r.id}`} className="block hover:opacity-80">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{r.category.replace("_", " ")}</span>
                          {r.tags && r.tags.length > 0 ? (
                            r.tags.slice(0, 3).map((t) => (
                              <span key={t} className="rounded-full border border-line px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-ink-soft">{t}</span>
                            ))
                          ) : null}
                          {expiring ? (
                            <span className="rounded-full border border-amber/50 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-amber">expires in {dLeft}d</span>
                          ) : null}
                          {expired ? (
                            <span className="rounded-full border border-tomato/50 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-tomato">expired</span>
                          ) : null}
                        </div>
                        <p className="mt-1 font-serif text-[17px] text-ink truncate">{r.title}</p>
                        {r.description ? (
                          <p className="font-serif italic text-[13px] text-ink-soft truncate">{r.description}</p>
                        ) : null}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{fmtDate(r.uploaded_at)}</p>
                        <p className="font-mono text-[10px] text-clay">{fmtBytes(r.file_bytes)}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
