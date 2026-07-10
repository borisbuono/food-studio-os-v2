"use client";
import { useMemo, useState } from "react";

// Memory curation client. Filter chips by kind, per-row Confirm/Edit/Retire.
// Editorial identity: hairlines, no cards, per-entity accent for confirm.

type Row = {
  id: string;
  fact: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  kind: string | null;
  tags: string[] | null;
  entity_code: string | null;
  scope: string | null;
  confidence: number | null;
  confirmed_at: string | null;
  created_at: string;
  source_conversation_id: string | null;
};

type Extraction = { id: string; facts_inserted: number; created_at: string };

const KIND_FILTERS: [string, string][] = [
  ["all", "all"],
  ["person", "people"],
  ["place", "places"],
  ["preference", "preferences"],
  ["allergy", "allergies"],
  ["relationship", "relationships"],
  ["reminder", "reminders"],
  ["birthday", "birthdays"],
  ["upcoming", "upcoming"],
  ["other", "other"],
];

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  const months = Math.floor(days / 30);
  if (months < 12) return months + " month" + (months > 1 ? "s" : "") + " ago";
  const years = Math.floor(days / 365);
  return years + " year" + (years > 1 ? "s" : "") + " ago";
}

export default function MemoryClient(props: { entityCode: string; initialRows: Row[]; recentRuns: Extraction[] }) {
  const [rows, setRows] = useState<Row[]>(props.initialRows);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<null | { id: string; fact: string; kind: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => (r.kind || "other") === filter);
  }, [rows, filter]);

  const empty = rows.length === 0;
  const everRan = props.recentRuns.length > 0;

  async function confirmRow(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/assistant/memory/" + r.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const d = await res.json();
      if (d.ok && d.memory) {
        setRows((arr) => arr.map((x) => x.id === r.id ? d.memory : x));
        setFlash("confirmed");
      } else {
        setFlash("could not confirm");
      }
    } catch { setFlash("could not confirm"); }
    setBusy(null);
    setTimeout(() => setFlash(null), 2000);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    try {
      const res = await fetch("/api/assistant/memory/" + editing.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fact: editing.fact, kind: editing.kind }),
      });
      const d = await res.json();
      if (d.ok && d.memory) {
        setRows((arr) => arr.map((x) => x.id === editing.id ? d.memory : x));
        setEditing(null);
        setFlash("saved");
      } else {
        setFlash("could not save");
      }
    } catch { setFlash("could not save"); }
    setBusy(null);
    setTimeout(() => setFlash(null), 2000);
  }

  async function retireRow(r: Row) {
    if (!confirm("Retire this fact? The Assistant will stop using it.")) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/assistant/memory/" + r.id, { method: "DELETE" });
      const d = await res.json();
      if (d.ok) {
        setRows((arr) => arr.filter((x) => x.id !== r.id));
        setFlash("retired");
      } else {
        setFlash("could not retire");
      }
    } catch { setFlash("could not retire"); }
    setBusy(null);
    setTimeout(() => setFlash(null), 2000);
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-4">
        {KIND_FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={"font-mono text-[10px] uppercase tracking-wide pb-0.5 " + (filter === k ? "text-ink border-b border-ink" : "text-clay border-b border-transparent hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {flash ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-wide text-clay">{flash}</p>
      ) : null}

      {empty ? (
        <div className="mt-10 border-t border-black/10 pt-6">
          <p className="font-serif text-[16px] text-ink-soft">The Assistant learns as you use it.</p>
          <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
            Facts you tell it, patterns it spots — they show up here. Come back after a week of use.
          </p>
          {everRan ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
              {props.recentRuns.length} extraction run{props.recentRuns.length > 1 ? "s" : ""} completed, 0 facts stored yet.
            </p>
          ) : (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
              No extraction runs yet. The extractor fires after you close the Chef FAB.
            </p>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-10 border-t border-black/10 pt-6 font-serif italic text-[14px] text-ink-soft">
          Nothing under this filter.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10">
          {filtered.map((r) => {
            const isEditing = editing?.id === r.id;
            return (
              <li key={r.id} className="py-4">
                {isEditing ? (
                  <div>
                    <textarea
                      value={editing.fact}
                      onChange={(e) => setEditing({ ...editing, fact: e.target.value })}
                      rows={2}
                      className="w-full resize-none border-b border-ink/40 bg-transparent pb-1 font-serif text-[15px] leading-snug text-ink focus:outline-none focus:border-ink"
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <select
                        value={editing.kind}
                        onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                        className="border-b border-ink/40 bg-transparent pb-0.5 font-mono text-[10px] uppercase tracking-wide text-ink focus:outline-none"
                      >
                        {["person","place","thing","preference","allergy","relationship","reminder","birthday","upcoming","other"].map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                      <button
                        disabled={busy === r.id}
                        onClick={saveEdit}
                        className="font-mono text-[10px] uppercase tracking-wide disabled:opacity-40"
                        style={{ color: "var(--accent)" }}
                      >
                        {busy === r.id ? "saving…" : "save"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <p className="font-serif text-[15px] leading-snug text-ink">{r.fact}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-wide text-clay">
                        <span>{r.kind || "other"}</span>
                        <span>·</span>
                        <span>{relativeDate(r.created_at)}</span>
                        {typeof r.confidence === "number" && r.confidence > 0 ? (
                          <>
                            <span>·</span>
                            <span>{Math.round(r.confidence * 100)}% conf</span>
                          </>
                        ) : null}
                        {r.confirmed_at ? (
                          <>
                            <span>·</span>
                            <span style={{ color: "var(--accent)" }}>confirmed</span>
                          </>
                        ) : null}
                        {r.tags && r.tags.length ? (
                          <>
                            <span>·</span>
                            <span>{r.tags.join(", ")}</span>
                          </>
                        ) : null}
                        {r.source_conversation_id ? (
                          <>
                            <span>·</span>
                            <span>from conversation {String(r.source_conversation_id).slice(0, 8)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-4 pt-1">
                      <button
                        disabled={busy === r.id || !!r.confirmed_at}
                        onClick={() => confirmRow(r)}
                        className="font-mono text-[10px] uppercase tracking-wide disabled:opacity-40"
                        style={{ color: r.confirmed_at ? undefined : "var(--accent)" }}
                        title={r.confirmed_at ? "already confirmed" : "confirm this fact"}
                      >
                        {r.confirmed_at ? "confirmed" : "confirm"}
                      </button>
                      <button
                        disabled={busy === r.id}
                        onClick={() => setEditing({ id: r.id, fact: r.fact, kind: r.kind || "other" })}
                        className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink disabled:opacity-40"
                      >
                        edit
                      </button>
                      <button
                        disabled={busy === r.id}
                        onClick={() => retireRow(r)}
                        className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato disabled:opacity-40"
                      >
                        delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 border-t border-black/10 pt-4 font-serif italic text-[13px] text-ink-soft">
        Retire is soft — the row is marked retired but preserved for audit. Nothing is ever hard-deleted from memory.
      </p>
    </div>
  );
}
