"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// Sprint 3 · #3 — Email triage surface on /grow/inbox.
//
// Renders inside the "Email triage" segment tab. Talks to the Sprint 3 · #2
// API routes:
//   POST /api/assistant/email/triage
//   POST /api/assistant/email/draft
//   POST /api/assistant/email/send-draft
//   GET  /api/assistant/email/threads
//
// Also exposes an FAB integration hook — window.__fsAssistantInboxHooks:
//   - draftForHint(hint) → { ok, thread_id, draft_id, ... }
// The FAB inspects this hook on send() when the user's phrase looks like
// "draft a reply to <someone>" and hands off page-specific execution.
//
// Editorial identity: hairlines, mono micro-caps, serif prose. Priority chip
// coloured per rank. Draft drawer sits below the row like /grow/reputation.

type Channel = { id: string; account_ref: string; settings: any };
type Verdict = {
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  last_message_at: string;
  unread: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  category: string;
  reason: string;
  suggested_action: "draft_reply" | "flag" | "snooze" | "archive" | "no_action";
  playbook_hit?: string | null;
};

type ThreadMessage = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body_text: string;
  received_at: string;
};

type Draft = { draft_id: string; subject: string; to: string; body: string; thread_id: string };

const PRIORITY_COLOR: Record<number, string> = {
  1: "#B03A2E", // urgent — tomato/red
  2: "#B5701C", // ochre
  3: "#9C9282", // clay
  4: "#5A6B3B", // olive
  5: "#B7B4AF", // muted
};
const PRIORITY_LABEL: Record<number, string> = { 1: "urgent", 2: "soon", 3: "later", 4: "watch", 5: "ignore" };

function when(iso: string): string {
  const d = new Date(iso).getTime(); if (!d) return "";
  const m = Math.floor((Date.now() - d) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function displayName(from: string): string {
  // "Marie Meneghello <marie@meneghello.com>" → "Marie Meneghello"
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim();
}

export default function EmailTriageClient(props: { channels: Channel[]; initialChannelId?: string }) {
  const [channelId, setChannelId] = useState<string>(props.initialChannelId || props.channels[0]?.id || "");
  const channel = useMemo(() => props.channels.find((c) => c.id === channelId) || null, [channelId, props.channels]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadBody, setThreadBody] = useState<ThreadMessage[] | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null); // thread_id being drafted
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); // thread_id → Draft
  const [sending, setSending] = useState<string | null>(null); // draft_id being sent
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const canSend = !!(channel?.settings?.auto_send || channel?.settings?.supervised_send);

  // Triage on channel change.
  useEffect(() => {
    if (!channelId) return;
    setLoading(true); setErr(null); setVerdicts([]);
    fetch("/api/assistant/email/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, since_hours: 48 }) })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setVerdicts(d.verdicts || []); else setErr(d.error || "triage failed"); })
      .catch((e) => setErr(e?.message || "triage failed"))
      .finally(() => setLoading(false));
  }, [channelId]);

  // Publish page context + hooks for the FAB. The FAB will inspect
  // __fsAssistantInboxHooks.draftForHint when the user says something like
  // "draft a reply to <name>".
  const hooksRef = useRef<any>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fsAssistantContext = {
      route: "/grow/inbox",
      kind: "grow_inbox_email",
      channel: channel ? { id: channel.id, account_ref: channel.account_ref } : null,
      verdicts: verdicts.slice(0, 10).map((v) => ({
        thread_id: v.thread_id, from: v.from, subject: v.subject, priority: v.priority, category: v.category,
      })),
    };
    hooksRef.current = {
      async draftForHint(hint: string) {
        if (!channelId || !verdicts.length) return { ok: false, error: "no verdicts loaded" };
        const norm = (hint || "").toLowerCase();
        const match = verdicts.find((v) => {
          const name = displayName(v.from).toLowerCase();
          const subj = (v.subject || "").toLowerCase();
          return norm && (name && norm.includes(name.split(" ")[0])) || (subj && norm.includes(subj.split(" ")[0]));
        }) || verdicts[0];
        try {
          setDrafting(match.thread_id);
          const r = await fetch("/api/assistant/email/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, thread_id: match.thread_id, instructions: hint }) });
          const d = await r.json();
          setDrafting(null);
          if (!d.ok) return { ok: false, error: d.error || "draft failed" };
          setDrafts((prev) => ({ ...prev, [match.thread_id]: { draft_id: d.draft.draft_id, subject: d.draft.subject, to: d.draft.to, body: d.draft.body, thread_id: match.thread_id } }));
          setOpenThread(match.thread_id);
          return { ok: true, thread_id: match.thread_id, from: match.from, subject: match.subject, body: d.draft.body, draft_id: d.draft.draft_id };
        } catch (e: any) {
          setDrafting(null);
          return { ok: false, error: e?.message || "draft failed" };
        }
      },
    };
    (window as any).__fsAssistantInboxHooks = hooksRef.current;
    return () => {
      if (typeof window !== "undefined") {
        (window as any).__fsAssistantContext = null;
        (window as any).__fsAssistantInboxHooks = null;
      }
    };
  }, [channelId, channel, verdicts]);

  async function openReader(threadId: string) {
    if (openThread === threadId) { setOpenThread(null); return; }
    setOpenThread(threadId); setThreadBody(null);
    try {
      const r = await fetch(`/api/assistant/email/threads?channel_id=${encodeURIComponent(channelId)}&thread_id=${encodeURIComponent(threadId)}`);
      const d = await r.json();
      if (d.ok) setThreadBody(d.thread.messages || []); else setThreadBody([]);
    } catch { setThreadBody([]); }
  }

  async function draftFor(threadId: string, instructions?: string) {
    setDrafting(threadId);
    try {
      const r = await fetch("/api/assistant/email/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, thread_id: threadId, instructions: instructions || null }) });
      const d = await r.json();
      if (d.ok) setDrafts((prev) => ({ ...prev, [threadId]: { draft_id: d.draft.draft_id, subject: d.draft.subject, to: d.draft.to, body: d.draft.body, thread_id: threadId } }));
      else alert("Draft failed: " + (d.error || "unknown"));
    } catch (e: any) { alert("Draft failed: " + (e?.message || "unknown")); }
    setDrafting(null);
  }

  async function sendDraft(draft: Draft) {
    if (!canSend) { alert("This channel is Draft-only. Flip it to Supervised send in Assistant Settings first."); return; }
    if (!confirm("Send this draft?")) return;
    setSending(draft.draft_id);
    try {
      const r = await fetch("/api/assistant/email/send-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, draft_id: draft.draft_id }) });
      const d = await r.json();
      if (d.ok) {
        setDrafts((prev) => { const n = { ...prev }; delete n[draft.thread_id]; return n; });
        setVerdicts((v) => v.filter((x) => x.thread_id !== draft.thread_id));
      } else alert("Send failed: " + (d.error || "unknown"));
    } catch (e: any) { alert("Send failed: " + (e?.message || "unknown")); }
    setSending(null);
  }

  function regenDraft(draft: Draft) {
    setDrafts((prev) => { const n = { ...prev }; delete n[draft.thread_id]; return n; });
    draftFor(draft.thread_id);
  }

  function snooze(threadId: string) {
    setSnoozed((s) => { const n = new Set(s); n.add(threadId); return n; });
  }

  const rows = verdicts.filter((v) => !snoozed.has(v.thread_id));

  if (!props.channels.length) {
    return (
      <div className="mt-8 border-t border-line pt-8">
        <p className="font-serif italic text-[15px] text-ink-soft">
          Connect Gmail in <a href="/administrate/settings/assistant" className="text-tomato hover:text-ink">Assistant Settings</a> to see your triaged inbox here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Email triage</p>
          <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
            {channel ? `From ${channel.account_ref} · ${canSend ? "Supervised send" : "Draft only"}` : ""}
          </p>
        </div>
        {props.channels.length > 1 ? (
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
            className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[10px] uppercase tracking-wide text-ink outline-none focus:border-ink">
            {props.channels.map((c) => <option key={c.id} value={c.id}>{c.account_ref}</option>)}
          </select>
        ) : null}
      </div>

      {loading ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Reading the inbox…</p> : null}
      {err ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "#B03A2E" }}>⚠ {err}</p> : null}
      {!loading && !err && !rows.length ? <p className="mt-6 font-serif italic text-[14px] text-muted">Inbox is clear — nothing needs a reply.</p> : null}

      <ul className="mt-6 divide-y divide-line">
        {rows.map((v) => {
          const draft = drafts[v.thread_id];
          const isOpen = openThread === v.thread_id;
          return (
            <li key={v.thread_id} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: PRIORITY_COLOR[v.priority] }}>
                  {PRIORITY_LABEL[v.priority]} · {v.category}{v.playbook_hit ? " · " + v.playbook_hit : ""}
                </span>
                <span className="font-mono text-[10px] text-clay">{when(v.last_message_at)}</span>
              </div>
              <p className="mt-1 font-serif text-[17px] leading-relaxed text-ink">{v.subject}</p>
              <p className="mt-0.5 font-serif italic text-[14px] text-ink-soft">{v.snippet.slice(0, 220)}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                {displayName(v.from)}{v.unread ? " · unread" : ""}
                {v.reason ? " · " + v.reason.slice(0, 120) : ""}
              </p>

              <div className="mt-2 flex flex-wrap gap-3">
                <button onClick={() => openReader(v.thread_id)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">{isOpen ? "close" : "read"}</button>
                {!draft ? (
                  <button onClick={() => draftFor(v.thread_id)} disabled={drafting === v.thread_id} className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent, #B5701C)" }}>
                    {drafting === v.thread_id ? "drafting…" : "draft reply"}
                  </button>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent, #B5701C)" }}>draft ready ↓</span>
                )}
                <button onClick={() => snooze(v.thread_id)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">snooze</button>
                <button onClick={() => snooze(v.thread_id)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">archive</button>
              </div>

              {isOpen ? (
                <div className="mt-3 border-t border-line pt-3">
                  {threadBody === null ? <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Reading…</p> : threadBody.map((m) => (
                    <div key={m.id} className="mb-3">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{displayName(m.from)} · {when(m.received_at)}</p>
                      <p className="mt-1 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink-soft">{m.body_text.slice(0, 2000)}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {draft ? (
                <DraftDrawer
                  draft={draft}
                  canSend={canSend}
                  sending={sending === draft.draft_id}
                  regen={() => regenDraft(draft)}
                  send={() => sendDraft(draft)}
                  discard={() => setDrafts((prev) => { const n = { ...prev }; delete n[draft.thread_id]; return n; })}
                  onEdit={(next) => setDrafts((prev) => ({ ...prev, [draft.thread_id]: { ...draft, ...next } }))}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DraftDrawer(props: {
  draft: Draft;
  canSend: boolean;
  sending: boolean;
  regen: () => void;
  send: () => void;
  discard: () => void;
  onEdit: (next: Partial<Draft>) => void;
}) {
  const { draft } = props;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Draft reply</p>
      <div className="mt-2 grid grid-cols-[80px_1fr] items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">to</span>
        <input value={draft.to} onChange={(e) => props.onEdit({ to: e.target.value })}
          className="border-0 border-b border-line bg-transparent px-0 py-1 font-serif text-[14px] text-ink outline-none focus:border-ink" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">subject</span>
        <input value={draft.subject} onChange={(e) => props.onEdit({ subject: e.target.value })}
          className="border-0 border-b border-line bg-transparent px-0 py-1 font-serif text-[14px] text-ink outline-none focus:border-ink" />
      </div>
      <textarea value={draft.body} onChange={(e) => props.onEdit({ body: e.target.value })}
        rows={Math.min(20, Math.max(6, draft.body.split("\n").length + 2))}
        className="mt-3 w-full resize-y border border-line bg-paper p-3 font-serif text-[15px] leading-relaxed text-ink outline-none focus:border-ink" />
      <div className="mt-3 flex flex-wrap gap-3">
        <button onClick={props.send} disabled={props.sending || !props.canSend}
          style={{ background: "var(--accent, #B5701C)" }}
          className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40"
          title={!props.canSend ? "This channel is Draft-only. Enable Supervised send in Assistant Settings." : "Send this draft via Gmail"}>
          {props.sending ? "sending…" : (props.canSend ? "send" : "send · disabled")}
        </button>
        <button onClick={props.regen} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">regenerate</button>
        <button onClick={props.discard} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">discard</button>
      </div>
      {!props.canSend ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
          Draft-only channel — flip Supervised send on <a href="/administrate/settings/assistant" className="underline">Assistant Settings</a> to enable send.
        </p>
      ) : null}
    </div>
  );
}
