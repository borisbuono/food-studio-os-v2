"use client";

// ChefSlim — text-first Chef drawer.
//
// Boris walk (2026-08-30): the old AssistantFab tried to do everything
// (voice → tool chips → screenshot preview → intent classifier → capture
// → sheet) and read as "way way too many things going on... way more than
// even the native Claude interface." The bar for this rebuild is: **less
// than native Claude.**
//
// Design (locked with Boris same day):
//   - Single-circle FAB, bottom-right. One glyph (chat bubble). No badge,
//     no long-press, no "capture" branch. Capture has its own button now
//     (commit e16db28 unified it under /capture) — Chef is chat only.
//   - Tap FAB → drawer opens. Tap again / Escape / swipe-down on mobile
//     closes.
//   - Drawer = right-anchored 420px panel on desktop (full height),
//     bottom sheet ~85vh on mobile. **No dim backdrop.** Boris wants
//     Chef alongside the page, not in place of it.
//   - Inside: message stream on top, one text input at the bottom, one
//     mic button next to it. That's it. No tool chips, no suggestions,
//     no screenshot preview.
//
// Preserved from AssistantFab (this is the working plumbing):
//   - /api/ask contract (unchanged) with page_context piped SILENTLY.
//   - Route context via window.__fsAssistantContext + pillarForRoute().
//   - Voice via Whisper: POST audio to /api/assistant/voice/transcribe,
//     scrub silent-audio hallucinations.
//   - body[data-fab="hidden"] override so pages can hide the FAB.
//
// Deliberately NOT ported from AssistantFab (~1400 → ~350 lines):
//   - Long-press → camera. (Capture is its own button now.)
//   - Wine-scan branch. (Same reason.)
//   - Tool-suggestion chips. (Boris: "way too many things going on.")
//   - Screenshot-preview thumbnails.
//   - Intent-classifier confidence chips + "did you mean" ladder.
//   - Web Speech API fallback (Whisper is the only path — reliable
//     everywhere).
//   - Language selector chip (still passes fs_lang cookie).
//   - Snap-point drag handle (single fixed size per breakpoint).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { EntityKey } from "@/lib/entities";
import { pillarForRoute } from "@/lib/routing/pillar-map";

type Msg = { role: "you" | "chef" | "sys"; text: string };

const WHISPER_JUNK = new Set([
  "thank you for watching", "thanks for watching", "thanks for watching!",
  "thank you.", "thank you", "thank you very much", "you", "bye", "bye.",
  "bye bye", ".", "..", "...", "¡gracias por ver!", "gracias por ver", "gracias",
]);
function scrubWhisper(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const lc = t.toLowerCase().replace(/[!?.,]+$/, "").trim();
  if (WHISPER_JUNK.has(lc)) return "";
  return t;
}

const WHISPER_MAX_MS = 60_000;

function readLang(): "en" | "es" | "da" {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|es|da)/);
  if (m?.[1]) return m[1] as "en" | "es" | "da";
  return "en";
}

export default function ChefSlim() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);

  // Refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionRef = useRef<string>("");
  const streamListRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getMyProfile().then(setProfile).catch(() => setProfile(null));
    try { sessionRef.current = (crypto as any).randomUUID?.() || String(Date.now()); } catch { sessionRef.current = String(Date.now()); }
  }, []);

  // Hide-on-route via body[data-fab="hidden"] (mirrored from AssistantFab)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setHidden(document.body.getAttribute("data-fab") === "hidden");
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-fab"] });
    return () => mo.disconnect();
  }, [pathname]);

  // Escape closes on desktop
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-scroll to latest message
  useEffect(() => {
    const el = streamListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending]);

  // Focus textarea when opened
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 60);
  }, [open]);

  const stopMic = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMsgs((m) => [...m, { role: "you", text: trimmed }]);
    setInput("");
    setSending(true);
    try {
      const ent = (!profile?.isAdmin
        ? profile?.entity
        : (typeof window !== "undefined" ? ((localStorage.getItem("fs_entity") as EntityKey) || "bistro_mondo") : "bistro_mondo")
      ) || "bistro_mondo";

      const basePageCtx = (typeof window !== "undefined" ? (window as any).__fsAssistantContext : null) || {};
      const activePillar = pillarForRoute(pathname || "");
      const pageContextWithPillar = { ...basePageCtx, active_pillar: activePillar };

      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          route: pathname || "",
          session_id: sessionRef.current,
          entity_id: ent,
          language: readLang(),
          page_context: pageContextWithPillar,
        }),
      });
      const d = await r.json().catch(() => ({}));
      const reply = (d?.reply || d?.text || "…").toString();
      setMsgs((m) => [...m, { role: "chef", text: reply }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "sys", text: "Chef offline — " + (e?.message || "network") }]);
    } finally {
      setSending(false);
    }
  }, [pathname, profile, sending]);

  // Voice — press-and-hold mic (Whisper stop-and-send)
  const startListening = useCallback(async () => {
    if (listening || sending) return;
    setVoiceErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceErr("Voice not supported in this browser."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm"))
        ? "audio/webm"
        : (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopMic();
        setListening(false);
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("route", pathname || "");
          const r = await fetch("/api/assistant/voice/transcribe", { method: "POST", body: fd });
          const d = await r.json().catch(() => ({}));
          if (!d?.ok || !d?.text) {
            setVoiceErr(d?.error || "Couldn't transcribe — try again."); return;
          }
          const cleaned = scrubWhisper(d.text);
          if (!cleaned) return;
          void sendMessage(cleaned);
        } catch (err: any) {
          setVoiceErr("Voice error: " + (err?.message || "unknown"));
        }
      };
      rec.start();
      setListening(true);
      setTimeout(() => { if (rec.state === "recording") { try { rec.stop(); } catch {} } }, WHISPER_MAX_MS);
    } catch (e: any) {
      setVoiceErr("Mic permission needed.");
    }
  }, [listening, pathname, sending, sendMessage, stopMic]);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try { recorderRef.current.stop(); } catch {}
    }
  }, []);

  // Mobile swipe-down to close
  const onTouchStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current == null) return;
    const dy = e.touches[0].clientY - dragStartYRef.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (dragStartYRef.current == null) return;
    const dy = (e.changedTouches[0]?.clientY ?? dragStartYRef.current) - dragStartYRef.current;
    dragStartYRef.current = null;
    if (sheetRef.current) sheetRef.current.style.transform = "";
    if (dy > 90) setOpen(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) void sendMessage(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter for newline (native Claude convention Boris knows)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) void sendMessage(input);
    }
  };

  const empty = useMemo(() => msgs.length === 0, [msgs]);

  if (hidden) return null;

  return (
    <>
      {/* Drawer — right-anchored on desktop, bottom sheet on mobile. No backdrop. */}
      {open ? (
        <div
          ref={sheetRef}
          role="dialog"
          aria-label="Chef"
          className={
            "fixed z-50 flex flex-col bg-paper shadow-2xl shadow-black/20 " +
            "inset-x-0 bottom-0 h-[85vh] rounded-t-2xl border-t border-black/10 " +
            "lg:inset-x-auto lg:top-0 lg:bottom-0 lg:right-0 lg:h-full lg:w-[420px] " +
            "lg:rounded-none lg:border-t-0 lg:border-l lg:border-black/10 lg:shadow-xl"
          }
          style={{ transition: "transform 200ms ease" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b border-black/10 px-4 py-3 lg:px-5 lg:py-4"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Drag handle (mobile only visual) */}
            <div className="lg:hidden absolute left-1/2 top-1.5 -translate-x-1/2 h-1 w-10 rounded-full bg-black/20" />
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-mono text-[#F7F7F4]"
                style={{ background: "var(--accent)" }}
              >
                C
              </span>
              <span className="font-serif text-[15px] text-ink">Chef</span>
            </div>
            <button
              type="button"
              aria-label="Close Chef"
              className="rounded-full p-2 text-ink-soft transition hover:bg-black/5 hover:text-ink"
              onClick={() => setOpen(false)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Message stream */}
          <div
            ref={streamListRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5"
          >
            {empty ? (
              <p className="font-serif italic text-[14px] leading-relaxed text-ink-soft">
                Ask Chef anything about what's on this screen.
              </p>
            ) : (
              <ul className="space-y-3">
                {msgs.map((m, i) => (
                  <li key={i}>
                    {m.role === "you" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 font-sans text-[14px] leading-snug text-[#F7F7F4]">
                          {m.text}
                        </div>
                      </div>
                    ) : m.role === "chef" ? (
                      <div className="flex justify-start">
                        <div className="max-w-[92%] whitespace-pre-line font-serif text-[15px] leading-relaxed text-ink">
                          {m.text}
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] uppercase tracking-wide text-clay">{m.text}</div>
                    )}
                  </li>
                ))}
                {sending ? (
                  <li>
                    <div className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">…</div>
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={onSubmit}
            className="border-t border-black/10 bg-paper px-3 py-3 lg:px-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
          >
            {voiceErr ? (
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wide" style={{ color: "#9A3122" }}>{voiceErr}</p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={listening ? "Listening…" : "Message Chef"}
                rows={1}
                disabled={listening}
                className="min-h-[40px] max-h-[160px] flex-1 resize-none rounded-2xl border border-black/10 bg-paper px-3 py-2 font-sans text-[14px] leading-snug text-ink outline-none focus:border-ink/40"
              />
              {/* Mic — press-and-hold */}
              <button
                type="button"
                aria-label={listening ? "Stop recording" : "Hold to speak"}
                onPointerDown={(e) => { e.preventDefault(); void startListening(); }}
                onPointerUp={() => { if (listening) stopListening(); }}
                onPointerLeave={() => { if (listening) stopListening(); }}
                onPointerCancel={() => { if (listening) stopListening(); }}
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition " +
                  (listening
                    ? "border-transparent text-[#F7F7F4] animate-pulse"
                    : "border-black/10 text-ink hover:bg-black/5")
                }
                style={listening ? { background: "var(--accent)" } : undefined}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {/* Send */}
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim() || sending || listening}
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#F7F7F4] transition disabled:opacity-40 " +
                  (sending ? "" : "")
                }
                style={{ background: "var(--accent)" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M2 8l12-6-6 12-1.5-5L2 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* FAB — single circle, one glyph, no long-press, no badge. */}
      <button
        type="button"
        aria-label={open ? "Close Chef" : "Open Chef"}
        onClick={() => setOpen((v) => !v)}
        className="fs-fab-safe fixed right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full text-[#F7F7F4] shadow-lg shadow-black/25 transition active:scale-95"
        style={{ background: "var(--accent)", touchAction: "manipulation" }}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9A2.5 2.5 0 0 1 17.5 17H9.8l-4 3.4A.75.75 0 0 1 4.6 20V5.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );
}
