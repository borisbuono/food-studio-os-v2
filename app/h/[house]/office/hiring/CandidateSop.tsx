"use client";

// SOP panels for the hiring board: CV intake form, and the drawer blocks
// for the read profile, the screening-question draft, and reply ingest.
// Nothing here sends a message — Boris copies/opens in mail, sends, taps Mark sent.

import { useEffect, useState } from "react";

type Field = { value: any; confidence: number };
export type SopCandidate = {
  id: string;
  entity_id?: string;
  name: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  profile?: Record<string, Field> | null;
  summary?: string | null;
  review_flags?: string[] | null;
  score?: number | null;
  score_reasons?: Array<{ label: string; points: number }> | null;
  cv_path?: string | null;
  retain_until?: string | null;
};

const LOW = 0.6;

export function IntakeForm({
  entityId,
  openings,
  onCreated,
}: {
  entityId: string;
  openings: Array<{ id: string; title: string }>;
  onCreated: (c: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState("");
  const [source, setSource] = useState("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!file && !note.trim()) return setErr("Attach the CV or paste the message.");
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("entity_id", entityId);
      if (file) fd.set("file", file);
      fd.set("note", note);
      fd.set("source", source);
      if (opening) fd.set("job_opening_id", opening);
      const r = await fetch("/api/hiring/candidates/intake", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) return setErr(j.error || `HTTP ${r.status}`);
      if (j.parse_error) setErr(`Saved, but the CV wasn't read: ${j.parse_error}. Retry from the card.`);
      onCreated(j.candidate);
      setFile(null);
      setNote("");
      if (!j.parse_error) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-black/15 bg-black px-3 py-1.5 text-xs text-white">
        Add CV
      </button>
    );

  return (
    <div className="mt-3 w-full rounded border border-black/15 bg-white p-3 text-xs">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold uppercase tracking-wide text-clay">New application</span>
        <button onClick={() => setOpen(false)} className="underline">close</button>
      </div>
      <p className="mt-1 text-clay">Drop the CV and paste the email. The OS reads it, scores it and drafts the screening questions. Nothing is sent.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <select value={opening} onChange={(e) => setOpening(e.target.value)} className="rounded border border-black/15 px-1.5 py-1">
          <option value="">No specific opening</option>
          {openings.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded border border-black/15 px-1.5 py-1">
          {["email", "whatsapp", "instagram", "walk_in", "referral", "portal"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="Paste the email / message that came with the CV"
        className="mt-2 w-full rounded border border-black/15 px-2 py-1"
      />
      {err ? <p className="mt-1 text-red-700">{err}</p> : null}
      <button disabled={busy} onClick={submit} className="mt-2 rounded border border-black/15 bg-black px-3 py-1.5 text-white disabled:opacity-50">
        {busy ? "Reading CV…" : "Read and draft questions"}
      </button>
    </div>
  );
}

function fmt(v: any): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

const PROFILE_ROWS: Array<[string, string]> = [
  ["current_role", "Now"],
  ["kitchen_years", "Kitchen years"],
  ["seniority", "Level"],
  ["stations", "Stations"],
  ["location", "Lives"],
  ["lives_on_island_year_round", "On island all year"],
  ["wants_year_round", "Wants winter work"],
  ["availability", "Availability"],
  ["languages", "Languages"],
  ["right_to_work", "Right to work"],
  ["training", "Training"],
  ["salary_expectation", "Salary"],
  ["weekends", "Weekends"],
  ["transport", "Transport"],
  ["references", "References"],
  ["station_preference", "Station pref."],
  ["allergen_training", "Allergens"],
];

export function ProfileBlock({ c, onUpdated }: { c: SopCandidate; onUpdated: (c: any) => void }) {
  const [busy, setBusy] = useState(false);
  const p = c.profile || {};
  async function reread() {
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}/cv`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      onUpdated(j.candidate);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 rounded border border-black/10 p-3 text-xs">
      <div className="flex items-baseline justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Read from CV</h4>
        <div className="flex gap-2">
          {c.cv_path ? (
            <a href={`/api/hiring/candidates/${c.id}/cv`} target="_blank" rel="noreferrer" className="underline">CV</a>
          ) : null}
          <button onClick={reread} disabled={busy} className="underline disabled:opacity-40">{busy ? "reading…" : "re-read"}</button>
        </div>
      </div>
      {!c.cv_path && c.entity_id ? (
        <label className="mt-1.5 block text-clay">
          Attach CV (reads it and redrafts the questions):{" "}
          <input
            type="file"
            accept="application/pdf,image/*"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const fd = new FormData();
                fd.set("entity_id", c.entity_id!);
                fd.set("candidate_id", c.id);
                fd.set("file", f);
                const r = await fetch("/api/hiring/candidates/intake", { method: "POST", body: fd });
                const j = await r.json();
                if (!r.ok || !j.ok) return alert(j.error || "failed");
                if (j.parse_error) alert("CV saved, not read: " + j.parse_error);
                onUpdated(j.candidate);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      ) : null}
      {c.summary ? <p className="mt-1.5">{c.summary}</p> : null}
      <div className="mt-1 text-clay">
        {c.phone || "—"} · {c.email || "—"}
      </div>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5">
        {PROFILE_ROWS.filter(([k]) => p[k] && p[k].value != null).map(([k, label]) => (
          <div key={k} className="contents">
            <dt className="text-clay">{label}</dt>
            <dd className={p[k].confidence < LOW ? "text-amber-700" : ""}>
              {fmt(p[k].value)}
              {p[k].confidence < LOW ? " (check)" : ""}
            </dd>
          </div>
        ))}
      </dl>
      {p.roles_held?.value?.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-clay">Roles held ({p.roles_held.value.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {p.roles_held.value.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {c.score != null ? (
        <div className="mt-3">
          <div className="font-semibold">
            Screening score {c.score}/100
            {c.score >= 60 && p.right_to_work?.value === "yes" && p.weekends?.value !== false ? (
              <span className="ml-2 rounded bg-black px-1.5 py-0.5 text-[10px] font-normal text-white">ready for interview</span>
            ) : null}
          </div>
          <ul className="mt-1 space-y-0.5">
            {(c.score_reasons || []).map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{r.label}</span>
                <span className="tabular-nums text-clay">{r.points > 0 ? `+${r.points}` : r.points}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.review_flags?.length ? (
        <ul className="mt-2 space-y-0.5 text-amber-700">
          {c.review_flags.map((f, i) => (
            <li key={i}>⚑ {f}</li>
          ))}
        </ul>
      ) : null}
      {c.retain_until ? <p className="mt-2 text-[10px] text-clay">Data kept until {c.retain_until} unless hired.</p> : null}
    </div>
  );
}

export function QuestionsBlock({
  c,
  touches,
  onTouch,
  onCandidate,
}: {
  c: SopCandidate;
  touches: any[];
  onTouch: (t: any, replaceId?: string) => void;
  onCandidate: (c: any) => void;
}) {
  const draft = touches.find((t) => t.kind === "question_set" && t.status === "drafted");
  const sent = touches.find((t) => t.kind === "question_set" && t.status === "sent");
  const [lang, setLang] = useState<"es" | "en">("es");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [replyOut, setReplyOut] = useState<{ concerns: string[]; ready: boolean } | null>(null);

  useEffect(() => {
    if (draft) setText(lang === "es" ? draft.body || "" : draft.body_alt || "");
  }, [draft?.id, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(extra: Record<string, unknown> = {}) {
    if (!draft) return;
    const r = await fetch(`/api/hiring/candidates/${c.id}/touch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch_id: draft.id, [lang === "es" ? "body" : "body_alt"]: text, ...extra }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) return alert(j.error || "failed");
    onTouch(j.touch, draft.id);
    if (extra.status === "sent" && c.status === "new") onCandidate({ ...c, status: "screening" });
  }

  async function redraft() {
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}/questions`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      onTouch(j.draft, draft?.id);
    } finally {
      setBusy(false);
    }
  }

  async function ingestReply() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      onCandidate(j.candidate);
      setReplyOut({ concerns: j.concerns || [], ready: !!j.ready_for_interview });
      setReply("");
    } finally {
      setBusy(false);
    }
  }

  const mailto =
    c.email && draft
      ? `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(draft.subject || "")}&body=${encodeURIComponent(text)}`
      : null;

  return (
    <div className="mt-4 rounded border border-black/10 p-3 text-xs">
      <div className="flex items-baseline justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Screening questions</h4>
        <button onClick={redraft} disabled={busy} className="underline disabled:opacity-40">{draft ? "redraft" : "draft"}</button>
      </div>
      {sent ? (
        <p className="mt-1 text-clay">
          Sent {new Date(sent.touched_at).toLocaleDateString()} — waiting for reply.
        </p>
      ) : null}
      {draft ? (
        <>
          <div className="mt-2 flex gap-1">
            {(["es", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded border px-2 py-0.5 ${lang === l ? "border-black bg-black text-white" : "border-black/15"}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <span className="ml-auto text-clay">{draft.subject}</span>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="mt-2 w-full rounded border border-black/15 px-2 py-1 font-mono text-[11px]" />
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button onClick={() => navigator.clipboard.writeText(text)} className="rounded border border-black/15 px-2 py-1">Copy</button>
            {mailto ? (
              <a href={mailto} className="rounded border border-black/15 px-2 py-1">Open in mail</a>
            ) : null}
            <button onClick={() => save()} className="rounded border border-black/15 px-2 py-1">Save edits</button>
            <button onClick={() => save({ status: "sent" })} className="rounded border border-black/15 bg-black px-2 py-1 text-white">Mark sent</button>
          </div>
          <p className="mt-1 text-[10px] text-clay">Drafts only. Send from your own mail, then tap Mark sent.</p>
        </>
      ) : !sent ? (
        <p className="mt-1 text-clay">No draft yet.</p>
      ) : null}

      <div className="mt-3 border-t border-black/10 pt-2">
        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Their reply</h5>
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Paste the candidate's answer" className="mt-1 w-full rounded border border-black/15 px-2 py-1" />
        <button disabled={busy || !reply.trim()} onClick={ingestReply} className="mt-1 rounded border border-black/15 bg-black px-2 py-1 text-white disabled:opacity-40">
          {busy ? "Reading…" : "Read reply and re-score"}
        </button>
        {replyOut ? (
          <div className="mt-2">
            {replyOut.ready ? <p className="font-semibold">Ready for interview — schedule below.</p> : <p className="text-clay">Not interview-ready yet — see flags above.</p>}
            {replyOut.concerns.length ? (
              <ul className="mt-1 text-amber-700">
                {replyOut.concerns.map((x, i) => (
                  <li key={i}>⚑ {x}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
