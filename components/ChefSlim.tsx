"use client";

// ChefSlim — the "Chef is the shell, not a room" implementation.
//
// Fable design critic + builder converged 2026-07-25 on:
//   - ONE 56pt circle. No engine chip, no language dropdown, no wine chip,
//     no camera chip, no snap handle, no close X, no "stop" button.
//   - Chef is the layer under every page; the sheet is transient and
//     dissolves when its evidence lands (typically 4s after reply).
//   - Contextual chip inline: max ONE chip appears below the reply when
//     the intent needs a physical follow-up (📷 capture, 🍷 wine label,
//     ✓ save memory).
//   - Long-press FAB = camera direct (no voice necessary).
//   - Sheet attaches to FAB visually (no orphan window bug on portrait).
//
// Feature-flagged via `?slim=1` URL param OR `localStorage.fs_chef_slim=1`.
// Ships alongside the legacy AssistantFab. Zero risk to daily ops — old
// Chef stays default; slim activates on demand for Boris's walk.
//
// Voice: server-side Whisper via /api/assistant/voice/transcribe (with the
// scrubWhisper hallucination guard mirrored from the legacy component).
// Chat: /api/ask (unchanged — same contract).
// Camera intake: /api/capture (invoices / albarán / EOD) or /api/wine-scan
// (wine labels), auto-selected by heuristic on the user's transcript.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { EntityKey, ENTITY_ACCENT } from "@/lib/entities";
import { pillarForRoute } from "@/lib/routing/pillar-map";

type Mode = "idle" | "listening" | "thinking" | "replying";

const ENTITY_CODE: Record<string, string> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
const AUTO_DISMISS_MS = 4000;
const LONG_PRESS_MS = 500;
const WHISPER_MAX_MS = 60_000;

// Whisper silent-audio hallucinations — mirrored from AssistantFab. Trained
// on YouTube captions, the model defaults to closing remarks when input is
// silent or under ~1s.
const WHISPER_JUNK = new Set([
  "thank you for watching", "thanks for watching", "thank you", "thank you.",
  "thank you very much", "you", "bye", "bye bye", ".", "..", "...",
  "gracias por ver", "gracias", "¡gracias por ver!",
]);
function scrubWhisper(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const lc = t.toLowerCase().replace(/[!?.,]+$/, "").trim();
  if (WHISPER_JUNK.has(lc)) return "";
  return t;
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && (navigator as any).maxTouchPoints > 1);
}

export default function ChefSlim() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState<{ text: string; intent?: string; confidence?: number; needsConfirm?: boolean; memoryProposal?: any } | null>(null);
  const [errorPulse, setErrorPulse] = useState(false);

  // Refs for streaming voice
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const wineInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const dismissTimer = useRef<NodeJS.Timeout | null>(null);
  const sessionRef = useRef<string>(crypto.randomUUID?.() || String(Date.now()));

  useEffect(() => { getMyProfile().then(setProfile).catch(() => setProfile(null)); }, []);

  const clearDismiss = () => { if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; } };

  const stopAndCleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearDismiss();
    stopAndCleanup();
    setMode("idle");
    setTranscript("");
    setReply(null);
  }, [stopAndCleanup]);

  // Send to Chef API
  const sendToChef = useCallback(async (text: string) => {
    if (!text.trim()) { dismiss(); return; }
    setMode("thinking");
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const basePageCtx = (typeof window !== "undefined" ? (window as any).__fsAssistantContext : null) || {};
      const activePillar = pillarForRoute(pathname || "");
      const pageContextWithPillar = { ...basePageCtx, active_pillar: activePillar };
      const r = await fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text, route: pathname || "", session_id: sessionRef.current,
          entity_id: ent, language: "auto",
          page_context: pageContextWithPillar,
        }),
      });
      const d = await r.json();
      const needsConfirm = d.intent && typeof d.confidence === "number" && d.confidence < 0.6;
      setReply({ text: d.reply || "…", intent: d.intent, confidence: d.confidence, needsConfirm, memoryProposal: d.memory });
      setMode("replying");
      // Auto-dismiss on evidence unless the reply has pending obligations
      if (!needsConfirm && !d.memory && d.intent !== "capture") {
        dismissTimer.current = setTimeout(() => { dismiss(); }, AUTO_DISMISS_MS);
      }
    } catch (e: any) {
      setReply({ text: "⚠ Chef offline — " + (e?.message || "network") });
      setMode("replying");
      setErrorPulse(true); setTimeout(() => setErrorPulse(false), 3000);
    }
  }, [dismiss, pathname, profile]);

  // Whisper stop-and-send pipeline
  const startListening = useCallback(async () => {
    if (mode === "listening") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setReply({ text: "Voice not supported in this browser." }); setMode("replying"); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopAndCleanup();
        if (chunksRef.current.length === 0) { setMode("idle"); return; }
        setMode("thinking");
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("route", pathname || "");
          const r = await fetch("/api/assistant/voice/transcribe", { method: "POST", body: fd });
          const d = await r.json();
          if (!d?.ok || !d?.text) {
            setReply({ text: d?.error || "Couldn't transcribe — try again." });
            setMode("replying"); setErrorPulse(true); setTimeout(() => setErrorPulse(false), 3000);
            return;
          }
          const cleaned = scrubWhisper(d.text);
          if (!cleaned) { dismiss(); return; }
          setTranscript(cleaned);
          void sendToChef(cleaned);
        } catch (err: any) {
          setReply({ text: "Voice error: " + (err?.message || "unknown") });
          setMode("replying");
        }
      };
      rec.start();
      setMode("listening");
      setTranscript("");
      setReply(null);
      // Safety cap
      setTimeout(() => { if (rec.state === "recording") { try { rec.stop(); } catch {} } }, WHISPER_MAX_MS);
    } catch (e: any) {
      setReply({ text: "Mic permission needed." });
      setMode("replying"); setErrorPulse(true); setTimeout(() => setErrorPulse(false), 3000);
    }
  }, [mode, pathname, sendToChef, dismiss, stopAndCleanup]);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try { recorderRef.current.stop(); } catch {}
    }
  }, []);

  // FAB press handlers — tap = voice, long-press = camera direct
  const onPressDown = () => {
    clearDismiss();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      captureInputRef.current?.click(); // long-press = camera
    }, LONG_PRESS_MS);
  };
  const onPressUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      // It was a tap
      if (mode === "idle") { void startListening(); }
      else if (mode === "listening") { stopListening(); }
      else { dismiss(); }
    }
  };
  const onPressCancel = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  // Camera capture handler
  const onCapture = async (file?: File | null) => {
    if (!file) return;
    setMode("thinking");
    setReply({ text: "Reading the photo…" });
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("type", "auto");
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) {
        setReply({ text: "Couldn't file this — " + (d.error || "unknown") });
        setMode("replying"); return;
      }
      const summary = d.detected
        ? `${d.type}${d.detected.supplier_name ? " · " + d.detected.supplier_name : ""}${d.detected.total_eur != null ? " · €" + Number(d.detected.total_eur).toFixed(2) : ""}`
        : d.type;
      setReply({ text: `Filed: ${summary}. It'll appear on ${d.where === "invoice_inbox" ? "Finance" : d.where}.` });
      setMode("replying");
      dismissTimer.current = setTimeout(() => { dismiss(); }, AUTO_DISMISS_MS);
    } catch (e: any) {
      setReply({ text: "Upload error: " + (e?.message || "unknown") });
      setMode("replying");
    }
  };

  const onWineCapture = async (file?: File | null) => {
    if (!file) return;
    setMode("thinking");
    setReply({ text: "Reading the label…" });
    try {
      // downscale
      const blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 900; let { width, height } = img;
          if (width > max || height > max) { const sc = max / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
          const c = document.createElement("canvas"); c.width = width; c.height = height;
          c.getContext("2d")!.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url);
          c.toBlob((b) => b ? resolve(b) : reject(new Error("encode failed")), "image/jpeg", 0.75);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
        img.src = url;
      });
      const fd = new FormData();
      fd.append("file", blob, "wine.jpg");
      const r = await fetch("/api/wine-scan", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) {
        setReply({ text: "Couldn't read the label — " + (d.error || "unknown") });
        setMode("replying"); return;
      }
      const w = d.wine || {};
      const summary = [w.producer, w.name, w.vintage].filter(Boolean).join(" · ") || "wine";
      setReply({ text: `Label read: ${summary}. I've saved it to the cellar as a draft.` });
      setMode("replying");
      dismissTimer.current = setTimeout(() => { dismiss(); }, AUTO_DISMISS_MS);
    } catch (e: any) {
      setReply({ text: "Scan error: " + (e?.message || "unknown") });
      setMode("replying");
    }
  };

  // Intent-driven contextual chip
  const chipForReply = () => {
    if (!reply || mode !== "replying") return null;
    const uText = (transcript || "").toLowerCase();
    if (reply.intent === "capture") {
      const isWine = /\b(wine|vino|bottle|botella|label|etiqueta)\b/.test(uText);
      const ref = isWine ? wineInputRef : captureInputRef;
      return (
        <button
          onClick={() => ref.current?.click()}
          className="mt-3 w-full rounded-full border border-ink bg-ink px-4 py-3 font-mono text-[11px] uppercase tracking-wide text-paper"
        >
          {isWine ? "🍷 Take or choose the label photo" : "📷 Take or choose the photo"}
        </button>
      );
    }
    return null;
  };

  // Render — always render the FAB and file inputs; sheet only when active
  const active = mode !== "idle";
  const showTranscript = mode === "listening" || (mode === "thinking" && transcript);
  const showReply = (mode === "replying" || mode === "thinking") && (reply || transcript);

  return (
    <>
      {/* Hidden file inputs — click triggered by long-press or by contextual chip */}
      <input ref={captureInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onCapture(e.target.files?.[0])} />
      <input ref={wineInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onWineCapture(e.target.files?.[0])} />

      {/* Dim backdrop — tap to dismiss. Sheet & FAB sit above it. */}
      {active ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-300"
          onClick={dismiss}
          aria-hidden
        />
      ) : null}

      {/* Attached-to-FAB sheet — anchors bottom-right so it visually flows out of the FAB */}
      {active ? (
        <div
          className="fs-fab-safe fixed right-4 z-50 max-w-[min(94vw,420px)] rounded-3xl bg-paper p-4 shadow-2xl shadow-black/30"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)", // sits above the 56pt FAB with 16px gap
            border: "1px solid var(--line, rgba(0,0,0,.1))",
          }}
          role="dialog"
          aria-label="Chef"
        >
          {/* Transcript (live while listening or thinking) */}
          {showTranscript && transcript ? (
            <p className="font-serif italic text-[15px] leading-snug text-ink-soft">{transcript}</p>
          ) : null}
          {mode === "listening" && !transcript ? (
            <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Listening…</p>
          ) : null}
          {mode === "thinking" ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">…</p>
          ) : null}

          {/* Reply */}
          {showReply && reply ? (
            <>
              <p className="mt-2 whitespace-pre-line font-serif text-[17px] leading-relaxed text-ink">{reply.text}</p>
              {chipForReply()}
            </>
          ) : null}
        </div>
      ) : null}

      {/* THE FAB — one 56pt circle. Tap = voice; long-press = camera; tap-in-sheet-state = dismiss. */}
      <button
        aria-label="Chef"
        className={"fs-fab-safe fixed right-5 z-[60] h-14 w-14 select-none rounded-full font-serif text-[14px] text-[#F7F7F4] shadow-lg shadow-black/25 transition active:scale-95"}
        style={{ background: errorPulse ? "#9A3122" : "var(--accent)", touchAction: "manipulation" }}
        onPointerDown={onPressDown}
        onPointerUp={onPressUp}
        onPointerCancel={onPressCancel}
        onPointerLeave={onPressCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {mode === "listening" ? <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" /> : "Chef"}
      </button>
    </>
  );
}
