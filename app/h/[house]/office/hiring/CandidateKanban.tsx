"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVE_CANDIDATE_STATUSES, CANDIDATE_STATUSES, CandidateStatus } from "@/lib/hiring";
import { IntakeForm, ProfileBlock, QuestionsBlock, type SopCandidate } from "./CandidateSop";

type Candidate = {
  id: string;
  entity_id: string;
  job_opening_id: string | null;
  name: string;
  status: string;
  source: string | null;
  languages: string[] | null;
  right_to_work: string | null;
  updated_at: string;
  years_experience: number | null;
} & Omit<SopCandidate, "id" | "name" | "status">;

const KANBAN_COLUMNS: CandidateStatus[] = [
  "new",
  "screening",
  "interview",
  "trial",
  "offer",
  "hired",
];

const COLUMN_LABEL: Record<CandidateStatus, string> = {
  new: "New",
  screening: "Screening",
  interview: "Interview",
  trial: "Trial",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrew: "Withdrew",
};

export default function CandidateKanban({
  slug,
  entityId,
  openings,
  candidates: initial,
}: {
  slug: string;
  entityId: string;
  openings: Array<{ id: string; title: string }>;
  candidates: Candidate[];
}) {
  const [candidates, setCandidates] = useState<Candidate[]>(initial);
  const [openingFilter, setOpeningFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [langFilter, setLangFilter] = useState<string>("");
  const [rtwFilter, setRtwFilter] = useState<string>("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const sources = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.source).filter(Boolean))) as string[],
    [candidates]
  );
  const languages = useMemo(() => {
    const s = new Set<string>();
    for (const c of candidates) for (const l of c.languages || []) s.add(l);
    return Array.from(s);
  }, [candidates]);

  const filtered = candidates.filter((c) => {
    if (openingFilter && c.job_opening_id !== openingFilter) return false;
    if (sourceFilter && c.source !== sourceFilter) return false;
    if (langFilter && !(c.languages || []).includes(langFilter)) return false;
    if (rtwFilter && c.right_to_work !== rtwFilter) return false;
    return true;
  });

  const byStatus = new Map<string, Candidate[]>();
  for (const c of filtered) {
    const arr = byStatus.get(c.status) || [];
    arr.push(c);
    byStatus.set(c.status, arr);
  }

  const cols = showArchived
    ? ([...KANBAN_COLUMNS, "rejected", "withdrew"] as CandidateStatus[])
    : KANBAN_COLUMNS;

  const drawer = drawerId ? candidates.find((c) => c.id === drawerId) || null : null;

  async function advanceStatus(id: string, target: CandidateStatus, reason?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/candidates/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, reason }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        alert(j.error || `HTTP ${res.status}`);
        return;
      }
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...j.candidate } : c)));
    } finally {
      setBusy(false);
    }
  }

  function upsertCandidate(c: any) {
    setCandidates((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      if (i === -1) return [c, ...prev];
      const next = [...prev];
      next[i] = { ...next[i], ...c };
      return next;
    });
  }

  return (
    <div className="mt-3">
      <div className="mb-3">
        <IntakeForm
          entityId={entityId}
          openings={openings}
          onCreated={(c) => {
            upsertCandidate(c);
            setDrawerId(c.id);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-clay">Opening</span>
          <select
            value={openingFilter}
            onChange={(e) => setOpeningFilter(e.target.value)}
            className="rounded border border-black/15 bg-white px-1.5 py-1"
          >
            <option value="">All</option>
            {openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        {sources.length ? (
          <label className="flex items-center gap-1">
            <span className="text-clay">Source</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded border border-black/15 bg-white px-1.5 py-1"
            >
              <option value="">Any</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {languages.length ? (
          <label className="flex items-center gap-1">
            <span className="text-clay">Language</span>
            <select
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="rounded border border-black/15 bg-white px-1.5 py-1"
            >
              <option value="">Any</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1">
          <span className="text-clay">RTW</span>
          <select
            value={rtwFilter}
            onChange={(e) => setRtwFilter(e.target.value)}
            className="rounded border border-black/15 bg-white px-1.5 py-1"
          >
            <option value="">Any</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="sponsorship-needed">Sponsorship</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          <span className="text-clay">Show archived</span>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cols.map((s) => {
          const arr = byStatus.get(s) || [];
          return (
            <div key={s} className="rounded border border-black/10 bg-black/[0.02] p-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-clay">
                  {COLUMN_LABEL[s]}
                </span>
                <span className="tabular-nums text-[11px] text-clay">{arr.length}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {arr.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => setDrawerId(c.id)}
                    className="cursor-pointer rounded border border-black/10 bg-white px-2 py-1.5 text-xs hover:border-black/30"
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-medium">{c.name}</span>
                      {c.score != null ? (
                        <span className="tabular-nums text-[10px] text-clay">
                          {c.review_flags?.length ? "⚑ " : ""}
                          {c.score}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[10px] text-clay">
                      {c.source || "—"}
                      {c.years_experience ? ` · ${c.years_experience}y` : ""}
                      {c.languages?.length ? ` · ${c.languages.join(",")}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {drawer ? (
        <CandidateDrawer
          slug={slug}
          entityId={entityId}
          candidate={drawer}
          openings={openings}
          onClose={() => setDrawerId(null)}
          onAdvance={advanceStatus}
          onCandidate={upsertCandidate}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

function CandidateDrawer({
  slug,
  entityId,
  candidate,
  openings,
  onClose,
  onAdvance,
  onCandidate,
  busy,
}: {
  slug: string;
  entityId: string;
  candidate: Candidate;
  openings: Array<{ id: string; title: string }>;
  onClose: () => void;
  onAdvance: (id: string, target: CandidateStatus, reason?: string) => void;
  onCandidate: (c: any) => void;
  busy: boolean;
}) {
  const [touches, setTouches] = useState<any[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [touchChannel, setTouchChannel] = useState("whatsapp");
  const [touchDirection, setTouchDirection] = useState("outbound");
  const [touchNotes, setTouchNotes] = useState("");
  const [ivDate, setIvDate] = useState("");
  const [ivFormat, setIvFormat] = useState("in-person");
  const [ivLocation, setIvLocation] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, i] = await Promise.all([
          fetch(`/api/hiring/candidates/${candidate.id}/touch`, { cache: "no-store" }),
          fetch(`/api/hiring/interviews?candidate=${candidate.id}`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (t.ok) {
          const j = await t.json();
          if (j.ok) setTouches(j.touches || []);
        }
        if (i.ok) {
          const j = await i.json();
          if (j.ok) setInterviews(j.interviews || []);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  async function logTouch() {
    if (!touchNotes.trim() && !touchChannel) return;
    const res = await fetch(`/api/hiring/candidates/${candidate.id}/touch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: touchChannel, direction: touchDirection, notes: touchNotes }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error || "failed");
    setTouches((prev) => [j.touch, ...prev]);
    setTouchNotes("");
  }

  async function scheduleInterview() {
    if (!ivDate) return alert("Pick a date/time");
    const iso = new Date(ivDate).toISOString();
    const res = await fetch(`/api/hiring/interviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: candidate.id,
        scheduled_at: iso,
        format: ivFormat,
        location: ivLocation,
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error || "failed");
    setInterviews((prev) => [j.interview, ...prev]);
  }

  const openingLabel = openings.find((o) => o.id === candidate.job_opening_id)?.title || "(unassigned)";

  return (
    <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-serif text-lg">{candidate.name}</h3>
            <p className="text-[11px] text-clay">
              {candidate.status} · {openingLabel}
            </p>
          </div>
          <button onClick={onClose} className="text-xs underline">
            close
          </button>
        </div>

        <div className="mt-3 space-y-1 text-xs">
          <div>
            <span className="text-clay">Source: </span>
            {candidate.source || "—"}
          </div>
          <div>
            <span className="text-clay">Experience: </span>
            {candidate.years_experience ?? "—"}y
          </div>
          <div>
            <span className="text-clay">Languages: </span>
            {candidate.languages?.join(", ") || "—"}
          </div>
          <div>
            <span className="text-clay">Right to work: </span>
            {candidate.right_to_work || "—"}
          </div>
        </div>

        <ProfileBlock c={candidate} onUpdated={onCandidate} />
        <QuestionsBlock
          c={candidate}
          touches={touches}
          onCandidate={onCandidate}
          onTouch={(t, replaceId) =>
            setTouches((prev) => [t, ...prev.filter((x) => x.id !== replaceId && x.id !== t.id)])
          }
        />

        {/* Advance */}
        <div className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Advance</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CANDIDATE_STATUSES.map((s) => (
              <button
                key={s}
                disabled={busy || s === candidate.status}
                onClick={() => onAdvance(candidate.id, s, reason || undefined)}
                className="rounded border border-black/15 px-2 py-1 text-[11px] disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
          <input
            placeholder="reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 w-full rounded border border-black/15 px-2 py-1 text-xs"
          />
        </div>

        {/* Touches */}
        <div className="mt-5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Log touch</h4>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <select value={touchChannel} onChange={(e) => setTouchChannel(e.target.value)} className="rounded border border-black/15 px-1.5 py-1">
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="call">call</option>
              <option value="in-person">in-person</option>
            </select>
            <select value={touchDirection} onChange={(e) => setTouchDirection(e.target.value)} className="rounded border border-black/15 px-1.5 py-1">
              <option value="outbound">outbound</option>
              <option value="inbound">inbound</option>
            </select>
          </div>
          <textarea
            placeholder="notes"
            value={touchNotes}
            onChange={(e) => setTouchNotes(e.target.value)}
            className="mt-2 w-full rounded border border-black/15 px-2 py-1 text-xs"
            rows={2}
          />
          <button onClick={logTouch} className="mt-1 rounded border border-black/15 bg-black px-2 py-1 text-[11px] text-white">
            Log touch
          </button>
          <ul className="mt-2 space-y-1 text-[11px]">
            {touches.map((t) => (
              <li key={t.id} className="border-l border-black/10 pl-2">
                <span className="text-clay">
                  {new Date(t.touched_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })} ·{" "}
                  {t.channel} {t.direction}
                </span>
                {t.notes ? <div>{t.notes}</div> : null}
                {t.kind === "reply" && t.body ? (
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px]">{t.body}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {/* Interview */}
        <div className="mt-5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Schedule interview</h4>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
            <input
              type="datetime-local"
              value={ivDate}
              onChange={(e) => setIvDate(e.target.value)}
              className="rounded border border-black/15 px-1.5 py-1"
            />
            <select value={ivFormat} onChange={(e) => setIvFormat(e.target.value)} className="rounded border border-black/15 px-1.5 py-1">
              <option value="in-person">in-person</option>
              <option value="video">video</option>
              <option value="phone">phone</option>
              <option value="trial-shift">trial-shift</option>
            </select>
          </div>
          <input
            placeholder="location / link"
            value={ivLocation}
            onChange={(e) => setIvLocation(e.target.value)}
            className="mt-1 w-full rounded border border-black/15 px-2 py-1 text-xs"
          />
          <button onClick={scheduleInterview} className="mt-1 rounded border border-black/15 bg-black px-2 py-1 text-[11px] text-white">
            Schedule
          </button>
          <ul className="mt-2 space-y-1 text-[11px]">
            {interviews.map((iv) => (
              <li key={iv.id} className="border-l border-black/10 pl-2">
                <span className="text-clay">
                  {new Date(iv.scheduled_at).toLocaleString()} · {iv.format || "—"} · {iv.status}
                </span>
                {iv.recommendation ? <span className="ml-1">→ {iv.recommendation}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
