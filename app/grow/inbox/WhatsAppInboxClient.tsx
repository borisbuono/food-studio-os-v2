"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// Assistant Sprint 4 · #3 — WhatsApp inbox surface on /grow/inbox.
//
// Sub-tabs:
//   - Company lines (Business API)   → assistant_wa_events → conversations
//   - Personal lines (Desktop assist) → assistant_wa_drafts → copy queue
//
// The FAB integration hook window.__fsAssistantWhatsAppHooks is exposed the
// same way EmailTriageClient does for /grow/inbox email. The FAB inspects it
// on send() when the user says "draft a WhatsApp to <name>".

type Channel = {
  id: string;
  account_ref: string;
  channel_type: "whatsapp_personal" | "whatsapp_business";
  settings: any;
};

type WaChat = {
  chat_id: string;
  phone_number: string | null;
  contact_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
};

type WaDraft = {
  id: string;
  chat_id: string;
  body: string;
  status: "draft" | "sent" | "discarded";
  created_at: string;
  sent_at: string | null;
};

type SubTab = "company" | "personal";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime(); if (!d) return "";
  const m = Math.floor((Date.now() - d) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function displayNumber(n: string | null): string {
  if (!n) return "";
  // "34664213227" → "+34 664 213 227"
  const digits = n.replace(/[^0-9]/g, "");
  if (digits.length < 8) return n;
  return "+" + digits.slice(0, 2) + " " + digits.slice(2, 5) + " " + digits.slice(5, 8) + " " + digits.slice(8);
}

export default function WhatsAppInboxClient(props: { channels: Channel[] }) {
  const businessChannels = useMemo(() => props.channels.filter((c) => c.channel_type === "whatsapp_business"), [props.channels]);
  const personalChannels = useMemo(() => props.channels.filter((c) => c.channel_type === "whatsapp_personal"), [props.channels]);
  const [sub, setSub] = useState<SubTab>(businessChannels.length ? "company" : "personal");

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">WhatsApp</p>
          <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
            Company lines run through the Business Cloud API. Personal lines use the desktop-assist queue — the assistant drafts, you send.
          </p>
        </div>
      </div>

      <nav className="mt-4 flex gap-2">
        {(["company", "personal"] as SubTab[]).map((k) => {
          const on = sub === k;
          const label = k === "company" ? `Company lines · Business API` : `Personal lines · Desktop assist`;
          const count = k === "company" ? businessChannels.length : personalChannels.length;
          return (
            <button key={k} onClick={() => setSub(k)}
              className={"rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wide " + (on ? "bg-ink text-paper" : "border border-black/10 text-ink-soft")}>
              {label}{count ? ` · ${count}` : ""}
            </button>
          );
        })}
      </nav>

      {sub === "company" ? (
        <CompanyLinesView channels={businessChannels} />
      ) : (
        <PersonalLinesView channels={personalChannels} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// COMPANY LINES — Business API. Conversations derived from webhook events.
// --------------------------------------------------------------------------

function CompanyLinesView(props: { channels: Channel[] }) {
  const [channelId, setChannelId] = useState<string>(props.channels[0]?.id || "");
  const channel = useMemo(() => props.channels.find((c) => c.id === channelId) || null, [channelId, props.channels]);
  const [chats, setChats] = useState<WaChat[] | null>(null);
  const [drafts, setDrafts] = useState<WaDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draftingChat, setDraftingChat] = useState<string | null>(null);
  const [sendingDraft, setSendingDraft] = useState<string | null>(null);
  const canSend = !!(channel?.settings?.auto_send || channel?.settings?.supervised_send);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true); setErr(null); setChats(null); setDrafts([]);
    Promise.all([
      fetch(`/api/assistant/whatsapp/chats?channel_id=${encodeURIComponent(channelId)}`).then((r) => r.json()),
      fetch(`/api/assistant/whatsapp/drafts?channel_id=${encodeURIComponent(channelId)}&status=draft`).then((r) => r.json()),
    ]).then(([c, d]) => {
      if (c.ok) setChats(c.chats || []); else setErr(c.error || "chats failed");
      if (d.ok) setDrafts(d.drafts || []);
    }).catch((e) => setErr(e?.message || "load failed"))
      .finally(() => setLoading(false));
  }, [channelId]);

  async function draftFor(chatId: string, instructions?: string) {
    if (!channelId) return;
    setDraftingChat(chatId);
    try {
      const r = await fetch("/api/assistant/whatsapp/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, chat_id: chatId, instructions: instructions || null }) });
      const d = await r.json();
      if (d.ok) setDrafts((prev) => [d.draft, ...prev]); else alert("Draft failed: " + (d.error || "unknown"));
    } catch (e: any) { alert("Draft failed: " + (e?.message || "unknown")); }
    setDraftingChat(null);
  }

  async function sendDraft(draft: WaDraft) {
    if (!canSend) { alert("This channel is Draft-only. Flip Supervised send on in Assistant Settings first."); return; }
    if (!confirm("Send this WhatsApp message via the Business Cloud API?")) return;
    setSendingDraft(draft.id);
    try {
      const r = await fetch("/api/assistant/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, draft_id: draft.id }) });
      const d = await r.json();
      if (d.ok) setDrafts((prev) => prev.filter((x) => x.id !== draft.id));
      else alert("Send failed: " + (d.error || "unknown"));
    } catch (e: any) { alert("Send failed: " + (e?.message || "unknown")); }
    setSendingDraft(null);
  }

  async function discard(draft: WaDraft) {
    if (!confirm("Discard this draft?")) return;
    const r = await fetch("/api/assistant/whatsapp/discard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, draft_id: draft.id }) });
    const d = await r.json();
    if (d.ok) setDrafts((prev) => prev.filter((x) => x.id !== draft.id));
  }

  if (!props.channels.length) {
    return (
      <div className="mt-8 border-t border-line pt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">No company lines connected</p>
        <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
          Connect a WhatsApp Business number in <a href="/administrate/settings/assistant" className="text-tomato hover:text-ink">Assistant Settings → Channels → Connect WhatsApp Business</a>.
        </p>
        <p className="mt-2 font-serif text-[14px] text-ink-soft">
          Requires a Meta Business account with a verified phone number and an approved WABA. See Meta's <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer" className="underline">Cloud API setup guide</a>.
        </p>
      </div>
    );
  }

  const draftByChat = new Map<string, WaDraft>();
  for (const d of drafts) draftByChat.set(d.chat_id, d);

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <p className="font-serif italic text-[13px] text-ink-soft">
          {channel ? `From ${channel.account_ref} · ${canSend ? "Supervised send" : "Draft only"}` : ""}
        </p>
        {props.channels.length > 1 ? (
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
            className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[10px] uppercase tracking-wide text-ink outline-none focus:border-ink">
            {props.channels.map((c) => <option key={c.id} value={c.id}>{c.account_ref}</option>)}
          </select>
        ) : null}
      </div>

      {loading ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Reading recent conversations…</p> : null}
      {err ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "#B03A2E" }}>⚠ {err}</p> : null}
      {!loading && !err && chats && !chats.length ? (
        <p className="mt-6 font-serif italic text-[14px] text-muted">
          No recent conversations. When a guest messages your Business number, the event lands here.
        </p>
      ) : null}

      <ul className="mt-6 divide-y divide-line">
        {(chats || []).map((c) => {
          const draft = draftByChat.get(c.chat_id);
          return (
            <li key={c.chat_id} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
                  {c.contact_name || displayNumber(c.phone_number || c.chat_id)}
                </span>
                <span className="font-mono text-[10px] text-clay">{when(c.last_message_at)}</span>
              </div>
              {c.last_message_preview ? (
                <p className="mt-1 font-serif text-[15px] leading-relaxed text-ink">{c.last_message_preview}</p>
              ) : (
                <p className="mt-1 font-serif italic text-[13px] text-muted">(no preview)</p>
              )}

              <div className="mt-2 flex flex-wrap gap-3">
                {!draft ? (
                  <button onClick={() => draftFor(c.chat_id)} disabled={draftingChat === c.chat_id}
                    className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent, #B5701C)" }}>
                    {draftingChat === c.chat_id ? "drafting…" : "draft reply"}
                  </button>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent, #B5701C)" }}>draft ready ↓</span>
                )}
              </div>

              {draft ? (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Draft reply</p>
                  <p className="mt-2 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink">{draft.body}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button onClick={() => sendDraft(draft)} disabled={sendingDraft === draft.id || !canSend}
                      style={{ background: "var(--accent, #B5701C)" }}
                      className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40"
                      title={!canSend ? "This channel is Draft-only. Enable Supervised send in Assistant Settings." : "Send this draft via WhatsApp Business Cloud API"}>
                      {sendingDraft === draft.id ? "sending…" : (canSend ? "send" : "send · disabled")}
                    </button>
                    <button onClick={() => draftFor(c.chat_id)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">regenerate</button>
                    <button onClick={() => discard(draft)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">discard</button>
                  </div>
                  {!canSend ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                      Draft-only channel — flip Supervised send in <a href="/administrate/settings/assistant" className="underline">Assistant Settings</a> to enable send.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------
// PERSONAL LINES — desktop-assist queue.
// --------------------------------------------------------------------------

function PersonalLinesView(props: { channels: Channel[] }) {
  const [channelId, setChannelId] = useState<string>(props.channels[0]?.id || "");
  const channel = useMemo(() => props.channels.find((c) => c.id === channelId) || null, [channelId, props.channels]);
  const [drafts, setDrafts] = useState<WaDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const desktopAssist = !!channel?.settings?.desktop_assist;

  useEffect(() => {
    if (!channelId) return;
    setLoading(true); setErr(null); setDrafts([]);
    fetch(`/api/assistant/whatsapp/drafts?channel_id=${encodeURIComponent(channelId)}&status=draft`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setDrafts(d.drafts || []); else setErr(d.error || "drafts failed"); })
      .catch((e) => setErr(e?.message || "drafts failed"))
      .finally(() => setLoading(false));
  }, [channelId]);

  // Publish FAB hooks. When Boris says "draft a WhatsApp to Vanessa" on this
  // page, the FAB can pick a chat and call the draft endpoint.
  const hooksRef = useRef<any>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fsAssistantContext = {
      route: "/grow/inbox",
      kind: "grow_inbox_whatsapp",
      channel: channel ? { id: channel.id, account_ref: channel.account_ref, channel_type: channel.channel_type } : null,
      draft_count: drafts.length,
    };
    hooksRef.current = {
      async draftForHint(hint: string) {
        if (!channelId) return { ok: false, error: "no channel selected" };
        // Try to pull a chat_id out of the hint. Look for a phone number
        // (+34 664 21 32 27 etc), else fall through to a "who?" prompt.
        const digits = (hint || "").replace(/[^0-9]/g, "");
        if (digits.length < 8) return { ok: false, error: "no phone number in hint" };
        try {
          const r = await fetch("/api/assistant/whatsapp/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, chat_id: digits, instructions: hint }) });
          const d = await r.json();
          if (!d.ok) return { ok: false, error: d.error || "draft failed" };
          setDrafts((prev) => [d.draft, ...prev]);
          return { ok: true, chat_id: digits, subject: `WhatsApp to +${digits}`, body: d.draft.body, draft_id: d.draft.id };
        } catch (e: any) {
          return { ok: false, error: e?.message || "draft failed" };
        }
      },
    };
    (window as any).__fsAssistantWhatsAppHooks = hooksRef.current;
    return () => {
      if (typeof window !== "undefined") {
        (window as any).__fsAssistantContext = null;
        (window as any).__fsAssistantWhatsAppHooks = null;
      }
    };
  }, [channelId, channel, drafts.length]);

  async function copyBody(d: WaDraft) {
    try { await navigator.clipboard.writeText(d.body); setCopied(d.id); setTimeout(() => setCopied(null), 1600); }
    catch { alert("Copy failed — please select the text and copy manually."); }
  }

  async function openWeb(chat_id: string) {
    try {
      const r = await fetch("/api/assistant/whatsapp/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, chat_id }) });
      const d = await r.json();
      if (d.ok && d.url) window.open(d.url, "_blank", "noopener");
    } catch {}
  }

  async function markSent(d: WaDraft) {
    const r = await fetch("/api/assistant/whatsapp/mark-sent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, draft_id: d.id }) });
    const j = await r.json();
    if (j.ok) setDrafts((prev) => prev.filter((x) => x.id !== d.id));
  }

  async function discard(d: WaDraft) {
    if (!confirm("Discard this draft?")) return;
    const r = await fetch("/api/assistant/whatsapp/discard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_id: channelId, draft_id: d.id }) });
    const j = await r.json();
    if (j.ok) setDrafts((prev) => prev.filter((x) => x.id !== d.id));
  }

  if (!props.channels.length) {
    return (
      <div className="mt-8 border-t border-line pt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">No personal lines connected</p>
        <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
          Register a personal WhatsApp number in <a href="/administrate/settings/assistant" className="text-tomato hover:text-ink">Assistant Settings → Channels → + WhatsApp</a>, then flip <em>Enable Desktop Assist</em> on the channel row.
        </p>
        <p className="mt-2 font-serif text-[14px] text-ink-soft">
          The assistant will queue drafts here; you copy each one into WhatsApp Web yourself. Nothing is sent from the server.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <p className="font-serif italic text-[13px] text-ink-soft">
          {channel ? `From ${channel.account_ref}` : ""}
          {desktopAssist ? " · Desktop assist on" : " · Desktop assist off"}
        </p>
        <div className="flex items-baseline gap-3">
          {props.channels.length > 1 ? (
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
              className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[10px] uppercase tracking-wide text-ink outline-none focus:border-ink">
              {props.channels.map((c) => <option key={c.id} value={c.id}>{c.account_ref}</option>)}
            </select>
          ) : null}
          <button onClick={() => openWeb("")} className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent, #B5701C)" }}>Open WhatsApp Web ↗</button>
        </div>
      </div>

      {loading ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Reading the draft queue…</p> : null}
      {err ? <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "#B03A2E" }}>⚠ {err}</p> : null}
      {!loading && !err && !drafts.length ? (
        <p className="mt-6 font-serif italic text-[14px] text-muted">
          No pending drafts. Ask the Chef FAB to draft one — say "draft a WhatsApp to +34…"
        </p>
      ) : null}

      <ul className="mt-6 divide-y divide-line">
        {drafts.map((d) => (
          <li key={d.id} className="py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
                to {displayNumber(d.chat_id)}
              </span>
              <span className="font-mono text-[10px] text-clay">{when(d.created_at)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink">{d.body}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button onClick={() => copyBody(d)} className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper" style={{ background: "var(--accent, #B5701C)" }}>
                {copied === d.id ? "copied" : "copy to clipboard"}
              </button>
              <button onClick={() => openWeb(d.chat_id)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">open in WhatsApp Web ↗</button>
              <button onClick={() => markSent(d)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">mark as sent</button>
              <button onClick={() => discard(d)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">discard</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
