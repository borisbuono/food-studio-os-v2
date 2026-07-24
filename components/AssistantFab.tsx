"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { pillarForRoute } from "@/lib/routing/pillar-map";

// Assistant FAB (formerly Chef FAB v2) — Siri-style tap-to-start, bottom-sheet
// drawer, long-press = camera, confidence-gated intent chips with autolearning.
// Language follows the OS i18n setting (fs_lang cookie), hides on pages that set
// data-fab="hidden" on <body>.
//
// Foundation contract: /api/ask delegates to the Assistant Layer orchestrator
// and returns { reply, intent, confidence, order, feedback, memory,
// user_turn_id }. /api/chef/{confirm-intent,save-memory,log-action} continue
// to work (kept for continuity; write to the renamed assistant_* tables).
//
// Persona label ("Chef") is intentionally preserved — that's how operators
// address the assistant. Under the hood, everything is now Assistant Layer.

type Msg = { role: "you" | "chef" | "sys"; text: string; intent?: string | null; confidence?: number | null; userText?: string; turnId?: string; needsConfirm?: boolean; memoryProposal?: any; orderDraft?: any; feedback?: any };
const CONFIDENCE_THRESHOLD = 0.75;
const SNAP_POINTS = [0.4, 0.7, 0.95]; // viewport fractions

// FAB voice #1 (2026-07-28) — DEBUG gate. Boris flipped the flag on prod to
// trace the recognition lifecycle in the console. Cheap to keep in place; the
// checks are compiled away as no-ops when the env var is unset.
const FAB_DEBUG = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_FAB_DEBUG === "true");
const dbg = (...args: any[]) => { if (FAB_DEBUG && typeof console !== "undefined") console.log("[FAB voice]", ...args); };

// PWA #2 (2026-07-28) — voice-engine selection. Web Speech API is great on
// desktop Chrome but broken on iOS Safari: mic permission never sticks, the
// engine cuts off on the first ~2s of silence, and there's no config knob
// for either. On iOS (and any browser missing SpeechRecognition) we swap in
// server-side Whisper: MediaRecorder captures a clip, we POST it to
// /api/assistant/voice/transcribe, Whisper returns the text.
type VoiceEngine = "web-speech" | "whisper" | "none";
function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && (navigator as any).maxTouchPoints > 1);
}
function pickVoiceEngine(): VoiceEngine {
  if (typeof window === "undefined") return "none";
  const w = window as any;
  const hasWebSpeech = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const hasMediaRecorder = typeof w.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  const ios = detectIOS();
  // On iOS we always prefer Whisper — even if the browser exposes
  // SpeechRecognition, the behavior is unusable. Elsewhere: Web Speech first,
  // Whisper as a fallback, "none" if we can't do either.
  if (ios && hasMediaRecorder) return "whisper";
  if (hasWebSpeech) return "web-speech";
  if (hasMediaRecorder) return "whisper";
  return "none";
}
function pickMediaMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of candidates) {
    try { if ((MediaRecorder as any).isTypeSupported?.(m)) return m; } catch {}
  }
  return "";
}
// PWA #3 — Whisper cap raised to 60s so Boris can dictate longer notes on
// the go. Web Speech stays effectively unbounded (the browser controls it).
const WHISPER_MAX_MS = 60_000;

function readLang(): "en" | "es" | "da" {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|es|da)/);
  if (m?.[1]) return m[1] as "en" | "es" | "da";
  // Fall back to the browser language. Boris usually speaks English, but he
  // sometimes borrows a phone with an es-* OS — a mismatched recognition
  // language is one of the failure modes we've seen. When the cookie is
  // absent we take the browser's word for it.
  if (typeof navigator !== "undefined" && navigator.language) {
    const bl = navigator.language.toLowerCase();
    if (bl.startsWith("es")) return "es";
    if (bl.startsWith("da")) return "da";
    return "en";
  }
  return "en";
}
function newSessionId() { return (typeof crypto !== "undefined" && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2); }

export default function AssistantFab() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(0); // index into SNAP_POINTS
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [errorPulse, setErrorPulse] = useState(false);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [orderDraft, setOrderDraft] = useState<any[] | null>(null);
  const [lang, setLang] = useState<"en" | "es" | "da">("en");
  const sessionRef = useRef<string>(newSessionId());
  const lastExtractRef = useRef<string | null>(null);
  const userTurnCountRef = useRef<number>(0);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const textRef = useRef("");
  const finalRef = useRef("");
  const silenceTimer = useRef<any>(null);
  const pressTimer = useRef<any>(null);
  const longPressFired = useRef(false);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const wineInputRef = useRef<HTMLInputElement>(null);
  const [wineDraft, setWineDraft] = useState<any | null>(null);
  const [wineBusy, setWineBusy] = useState(false);
  // FAB voice #1 (2026-07-28) — the previous build tore down the recognition
  // instance every time `listening` flipped (because `listening` was in the
  // effect deps). The cleanup's r.stop() killed the just-started session
  // before onresult could fire — Boris saw "Listening" but the mic captured
  // nothing. We now hold the "want to keep listening" intent in a ref so the
  // onend auto-restart works without re-creating the recognition object, and
  // the effect only re-runs when `lang` changes.
  const wantListenRef = useRef(false);
  // Keep the latest handlers reachable from the recognition callbacks without
  // re-subscribing. onresult needs a fresh reference to stopAndSend so a
  // pause-triggered send doesn't call a stale closure.
  const stopAndSendRef = useRef<() => void>(() => {});
  // FAB voice #2 (2026-07-28) — live amplitude meter (waveform substitute)
  // and "still listening…" hint so Boris SEES the mic working, not just a
  // pulsing dot. amplitude ranges 0..1 and is sampled from an AnalyserNode
  // attached to a MediaStream we open alongside SpeechRecognition (they
  // share the same mic-permission grant, so no second prompt).
  // stillListening flips true after 4s of listening with no finalised text.
  const [amplitude, setAmplitude] = useState(0);
  const [stillListening, setStillListening] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const stillListeningTimer = useRef<any>(null);

  // PWA #2 — voice-engine state. Decided once on mount (client-only). While
  // transcribing over Whisper the FAB shows a spinner; edit-then-send lets
  // Boris fix a mistranscription before it hits the assistant.
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>("none");
  const [transcribing, setTranscribing] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStopReasonRef = useRef<"user" | "timeout" | "cancel">("user");
  const recordingTimeoutRef = useRef<any>(null);
  const recordingStartRef = useRef<number>(0);

  // FAB voice #3 (2026-07-28) — visible live transcript panel + edit-before-send.
  // Boris was hearing the mic tick on and off but seeing nothing on-screen; the
  // Web Speech interim text was buried inside the bottom sheet and Whisper only
  // showed anything AFTER the release. This panel is the fix: floating overlay
  // above the FAB, live-populated as the user speaks, editable at any time.
  // The panel is the primary voice surface — the bottom sheet stays for chat
  // history, camera and wine scan (long-press to reach it).
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [editBeforeSend, setEditBeforeSend] = useState(true); // default ON — safer
  const [sending, setSending] = useState(false);
  const [lastPair, setLastPair] = useState<{ you: string; chef: string } | null>(null);
  const chunkTimerRef = useRef<any>(null);
  const interimInFlightRef = useRef<boolean>(false);
  const autoSendPendingRef = useRef<boolean>(false);
  const userEditedRef = useRef<boolean>(false); // once true, interim upstream will not overwrite
  const panelTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { getMyProfile().then(setProfile); setLang(readLang()); setVoiceEngine(pickVoiceEngine()); }, []);

  // Hide-on-route via body[data-fab="hidden"] (read on path change)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setHidden(document.body.getAttribute("data-fab") === "hidden");
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-fab"] });
    return () => mo.disconnect();
  }, [pathname]);

  // Speech recognition — language from i18n. IMPORTANT: this effect must NOT
  // depend on `listening` — see wantListenRef comment above.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // PWA #2 — skip Web Speech entirely on iOS or when the engine picker
    // chose Whisper. We still need `supported` to reflect voice capability,
    // so set it based on whether ANY engine is available.
    if (voiceEngine === "whisper") {
      setSupported(true);
      return;
    }
    if (voiceEngine === "none") {
      setSupported(false);
      setStatus(lang === "es" ? "Voz no disponible en este navegador" : "Voice unavailable on this browser");
      return;
    }
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      dbg("SpeechRecognition unavailable — falling back to type-only");
      setSupported(false);
      // Try to at least warn the user which browser to use. We don't actually
      // request the mic here (that would prompt for no reason), we just check
      // whether the API surface exists at all. Firefox lands here today.
      setStatus(lang === "es" ? "Voz no soportada aquí — instala la app" : "Voice not supported here — install the app");
      return;
    }
    let r: any;
    try {
      r = new SR();
    } catch (err) {
      dbg("SpeechRecognition constructor threw", err);
      setSupported(false);
      setStatus(lang === "es" ? "Voz no disponible en este navegador" : "Voice unavailable on this browser");
      return;
    }
    // Siri-style tap-to-speak: single utterance, but we still ask for interim
    // results so the sheet can echo the transcript live as Boris speaks.
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = lang === "es" ? "es-ES" : lang === "da" ? "da-DK" : "en-US";
    dbg("recognition ready", { lang: r.lang, continuous: r.continuous });

    // Handlers MUST be attached before .start() — otherwise a fast utterance
    // (or a browser that fires onstart synchronously) can drop the first event.
    r.onstart = () => {
      dbg("onstart");
      setListening(true);
      setStatus(lang === "es" ? "Escuchando…" : "Listening…");
    };
    r.onaudiostart = () => dbg("onaudiostart");
    r.onsoundstart = () => dbg("onsoundstart");
    r.onspeechstart = () => {
      dbg("onspeechstart");
      setStatus(lang === "es" ? "Te escucho" : "Got you");
    };
    r.onspeechend = () => {
      // Fired by the engine when it thinks you've stopped. With continuous=false
      // this is normal — the engine will follow with onend shortly. We DON'T
      // stop() here because that races the internal finalisation.
      dbg("onspeechend");
    };
    r.onnomatch = () => {
      dbg("onnomatch");
      setStatus(lang === "es" ? "No entendí — vuelve a intentarlo" : "Didn't catch that — try again");
    };
    r.onresult = (e: any) => {
      // With continuous=false the engine still fires interim results in the
      // same event stream; we walk every result and stitch the transcript.
      let interim = "";
      let finalPiece = "";
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const res = e.results[i];
        const seg = (res[0]?.transcript || "");
        if (res.isFinal) finalPiece += seg; else interim += seg;
      }
      if (finalPiece) {
        finalRef.current = (finalRef.current + " " + finalPiece).replace(/\s+/g, " ").trim();
      }
      const full = (finalRef.current + " " + interim).replace(/\s+/g, " ").trim();
      dbg("onresult", { interim, finalPiece, full });
      setText(full); textRef.current = full;
      // Safety-net silence timer — 2.5s pause auto-sends. continuous=false
      // usually fires onend on its own, but Chrome-desktop occasionally sits
      // on an unfinalised interim for longer than Boris expects. This nudge
      // also gives us a deterministic pause length across browsers.
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (full) setStillListening(false);
      if (full) silenceTimer.current = setTimeout(() => {
        dbg("silence timer -> stopAndSend");
        // FAB voice #3 — the silence auto-send fires only when the user
        // has NOT enabled edit-before-send. In edit mode we simply stop
        // the recognition but leave the transcript for review.
        stopAndSendRef.current();
      }, 2500);
    };
    r.onerror = (e: any) => {
      const code = e?.error || "";
      dbg("onerror", code, e?.message);
      // "no-speech" and "aborted" are benign — the engine timed out or we
      // stopped it ourselves. Everything else deserves visible feedback so
      // Boris knows why the mic went quiet.
      if (code === "no-speech") {
        setStatus(lang === "es" ? "No oí nada — toca de nuevo" : "Didn't hear you — tap again");
        setListening(false);
        wantListenRef.current = false;
        return;
      }
      if (code === "aborted") {
        // Deliberate stop() — don't surface as an error.
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setStatus(lang === "es" ? "Permiso del micro bloqueado — tócalo para permitir." : "Mic blocked — allow it in the address bar.");
      } else if (code === "audio-capture") {
        setStatus(lang === "es" ? "Sin micrófono conectado." : "No microphone connected.");
      } else if (code === "network") {
        setStatus(lang === "es" ? "Red caída — reintenta." : "Network down — try again.");
      } else if (code === "language-not-supported") {
        setStatus(lang === "es" ? "Idioma no soportado en este navegador." : "Language not supported by this browser.");
      } else {
        setStatus((lang === "es" ? "Error de voz: " : "Voice error: ") + code);
      }
      setListening(false);
      wantListenRef.current = false;
      setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
    };
    r.onend = () => {
      dbg("onend", { want: wantListenRef.current, hasText: !!textRef.current });
      // With continuous=false, onend is the natural terminus of a single
      // utterance. If we have text we ship it; if we don't and the user still
      // wants to be listening (e.g. iOS Safari cut us off), restart.
      if (wantListenRef.current && !textRef.current) {
        try { r.start(); dbg("auto-restart after empty onend"); return; }
        catch (err) { dbg("auto-restart failed", err); }
      }
      setListening(false);
      if (textRef.current.trim()) {
        // Send whatever we finalised. Guard against the silence timer having
        // already scheduled a send — we clear it here.
        if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
        stopAndSendRef.current();
      }
      wantListenRef.current = false;
    };
    recRef.current = r;
    return () => {
      dbg("effect cleanup — lang changed or unmount");
      wantListenRef.current = false;
      // Detach handlers before abort so the aborted event doesn't ripple back
      // into React setState calls after unmount.
      try { r.onend = null; r.onresult = null; r.onerror = null; r.abort(); } catch {}
    };
    // Deps: lang + voiceEngine. `listening` intentionally omitted — see wantListenRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, voiceEngine]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, text]);

  // FAB voice #2 — start/stop the amplitude meter. We keep this deliberately
  // small: getUserMedia({audio}), pipe through an AnalyserNode, sample RMS in a
  // rAF loop, normalise to 0..1 for the CSS bar. If the user has already
  // granted SpeechRecognition permission, this doesn't reprompt — same origin,
  // same mic. If getUserMedia rejects (rare, permission race), we silently
  // fall back to a static bar; recognition itself is unaffected.
  const startMeter = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      if (!micStreamRef.current) {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (!audioCtxRef.current) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current!;
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
      if (!analyserRef.current) {
        const src = ctx.createMediaStreamSource(micStreamRef.current!);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyserRef.current = analyser;
      }
      const analyser = analyserRef.current!;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS around 128 (silence), scale to 0..1
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setAmplitude(Math.min(1, rms * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) { dbg("meter unavailable", err); }
  }, []);
  const stopMeter = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setAmplitude(0);
    // We keep the MediaStream open across sessions so the mic tab indicator
    // stays cool; if the FAB unmounts we'll tear it down in the effect below.
  }, []);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (stillListeningTimer.current) clearTimeout(stillListeningTimer.current);
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioCtxRef.current?.close(); } catch {}
  }, []);

  // FAB voice #3 — streaming-ish Whisper. MediaRecorder is already emitting
  // 250ms chunks (mr.start(250)). Every 3s while recording, we build a blob
  // from ALL chunks collected so far (webm containers are transcribable while
  // in-progress — Whisper is tolerant of the missing cues) and POST it with an
  // `interim=true` marker so the server skips the assistant_actions log entry.
  // The interim transcript lands in the panel textarea unless the operator
  // has already tapped to edit — userEditedRef guards against clobbering an
  // in-progress edit. Final blob on release still goes through mr.onstop and
  // replaces the interim text with the full-quality transcription.
  const submitInterimWhisper = useCallback(async () => {
    if (interimInFlightRef.current) return;
    const chunks = recordedChunksRef.current;
    if (!chunks.length) return;
    const mime = mediaRecorderRef.current?.mimeType || chunks[0]?.type || "audio/webm";
    // Snapshot copy — DO NOT splice the array (mr.onstop still needs every chunk).
    const blob = new Blob(chunks.slice(), { type: mime });
    if (blob.size < 2400) return; // too short for a useful transcription
    interimInFlightRef.current = true;
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const ENT_CODE: Record<string, "IFL"|"BM"|"BBH"> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };
      const entityCode = ENT_CODE[ent as string] || "IFL";
      const fd = new FormData();
      fd.append("audio", blob, `interim.${(mime.split("/")[1] || "webm").split(";")[0]}`);
      fd.append("lang", lang);
      fd.append("entity", entityCode);
      fd.append("interim", "true");
      fd.append("route", pathname || "");
      const r = await fetch("/api/assistant/voice/transcribe", { method: "POST", body: fd });
      const d = await r.json();
      if (d?.ok && typeof d?.text === "string" && d.text.trim()) {
        if (!userEditedRef.current) {
          setText(d.text); textRef.current = d.text; finalRef.current = d.text;
        }
      }
    } catch (err) { dbg("interim whisper failed", err); }
    finally { interimInFlightRef.current = false; }
  }, [lang, pathname, profile]);

  // PWA #2 — Whisper recording pipeline. Uses the same MediaStream the
  // amplitude meter opens (so no double-prompt for mic permission). While the
  // recorder is live the meter runs; on stop we assemble the blob and POST
  // it. The transcript lands in `text` — we DO NOT auto-send it. Boris asked
  // for edit-then-send so he can fix a mistranscription before it hits the
  // assistant. Cap the clip at WHISPER_MAX_MS (60s) so a stuck press doesn't
  // upload a 10-minute file.
  const startWhisperRecording = useCallback(async () => {
    setMicDenied(false);
    setStatus(lang === "es" ? "Escuchando…" : "Listening…");
    wantListenRef.current = true;
    setStillListening(false);
    finalRef.current = ""; textRef.current = ""; setText("");
    recordedChunksRef.current = [];
    recordingStopReasonRef.current = "user";
    if (stillListeningTimer.current) clearTimeout(stillListeningTimer.current);
    stillListeningTimer.current = setTimeout(() => {
      if (wantListenRef.current && !textRef.current) setStillListening(true);
    }, 4000);
    try {
      // startMeter opens the mic stream we can share.
      await startMeter();
      const stream = micStreamRef.current;
      if (!stream) throw new Error("mic stream unavailable");
      const mime = pickMediaMime();
      const opts: MediaRecorderOptions = mime ? { mimeType: mime } : {};
      const mr = new MediaRecorder(stream, opts);
      mediaRecorderRef.current = mr;
      recordingStartRef.current = Date.now();
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        // Regardless of reason, if we've got audio we transcribe.
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        setListening(false);
        stopMeter();
        wantListenRef.current = false;
        setStillListening(false);
        if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
        if (recordingStopReasonRef.current === "cancel") { dbg("whisper cancelled"); return; }
        if (!chunks.length) {
          setStatus(lang === "es" ? "No oí nada — vuelve a intentarlo" : "Didn't catch that — try again");
          return;
        }
        const blob = new Blob(chunks, { type: mime || chunks[0]?.type || "audio/webm" });
        // Very short clips (< 500ms) are usually accidental double-taps.
        if (blob.size < 800) {
          setStatus(lang === "es" ? "Muy corto — vuelve a hablar" : "Too short — try again");
          return;
        }
        setTranscribing(true);
        setStatus(lang === "es" ? "Transcribiendo…" : "Transcribing…");
        try {
          const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
          const ENT_CODE: Record<string, "IFL"|"BM"|"BBH"> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };
          const entityCode = ENT_CODE[ent as string] || "IFL";
          const fd = new FormData();
          fd.append("audio", blob, `voice.${(mime.split("/")[1] || "webm").split(";")[0]}`);
          fd.append("lang", lang);
          fd.append("entity", entityCode);
          fd.append("route", pathname || "");
          const r = await fetch("/api/assistant/voice/transcribe", { method: "POST", body: fd });
          const d = await r.json();
          if (!d?.ok || !d?.text) {
            const errMsg = d?.error || (lang === "es" ? "No pude transcribir" : "Couldn't transcribe");
            // PWA #3 — if the server is missing OPENAI_API_KEY, be explicit
            // about it so Boris knows this is a config gap, not a bug.
            const missingKey = typeof errMsg === "string" && /OPENAI_API_KEY/i.test(errMsg);
            setStatus(missingKey
              ? (lang === "es"
                ? "Voz degradada — falta OPENAI_API_KEY en el servidor."
                : "Voice degraded — server is missing OPENAI_API_KEY.")
              : errMsg);
            setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
          } else {
            // Edit-then-send: land the transcript in the input so Boris can
            // fix it before the assistant sees it. FAB voice #3 — if
            // autoSendPendingRef fired (Stop & Send with editBeforeSend=off),
            // we forward straight to the orchestrator.
            setText(d.text); textRef.current = d.text; finalRef.current = d.text;
            userEditedRef.current = false;
            if (autoSendPendingRef.current) {
              autoSendPendingRef.current = false;
              setStatus(lang === "es" ? "Enviando…" : "Sending…");
              setTimeout(() => { void send(); }, 0);
            } else {
              setStatus(lang === "es" ? "Revisa y toca Enviar" : "Review and tap Send");
            }
          }
        } catch (err: any) {
          setStatus((lang === "es" ? "Error de voz: " : "Voice error: ") + (err?.message || "unknown"));
          setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
        }
        setTranscribing(false);
      };
      mr.onerror = (ev: any) => {
        dbg("MediaRecorder error", ev?.error);
        setStatus((lang === "es" ? "Error de micro: " : "Mic error: ") + (ev?.error?.name || "unknown"));
      };
      mr.start(250); // small chunks so onstop has data even on quick releases
      setListening(true);
      // FAB voice #3 — kick off streaming interim uploads every 3s so the
      // panel textarea grows as Boris talks instead of sitting blank until
      // release. Cleared in stopWhisperRecording + mr.onstop cleanup.
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = setInterval(() => { void submitInterimWhisper(); }, 3000);
      // Auto-stop after WHISPER_MAX_MS so a stuck press doesn't record forever.
      recordingTimeoutRef.current = setTimeout(() => {
        recordingStopReasonRef.current = "timeout";
        try { mr.state !== "inactive" && mr.stop(); } catch {}
      }, WHISPER_MAX_MS);
    } catch (err: any) {
      dbg("whisper start failed", err?.message);
      if (String(err?.name || "").includes("NotAllowed") || /denied/i.test(String(err?.message || ""))) {
        setMicDenied(true);
        setStatus(lang === "es"
          ? "Micro bloqueado — ábrelo en Ajustes → Safari → Micrófono."
          : "Mic blocked — allow it in Settings → Safari → Microphone.");
      } else {
        setStatus(lang === "es" ? "No pude arrancar el micro." : "Couldn't start the mic.");
      }
      setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
      wantListenRef.current = false;
      setListening(false);
    }
  }, [lang, pathname, profile, startMeter, stopMeter]);

  const stopWhisperRecording = useCallback((reason: "user" | "cancel" = "user") => {
    if (recordingTimeoutRef.current) { clearTimeout(recordingTimeoutRef.current); recordingTimeoutRef.current = null; }
    if (stillListeningTimer.current) { clearTimeout(stillListeningTimer.current); stillListeningTimer.current = null; }
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    recordingStopReasonRef.current = reason;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try { mr.stop(); } catch {}
    } else {
      // Nothing to stop — pull the UI back ourselves.
      setListening(false);
      stopMeter();
      wantListenRef.current = false;
    }
  }, [stopMeter]);

  const startListen = useCallback(() => {
    // PWA #2 — engine-aware entry point.
    if (voiceEngine === "whisper") { startWhisperRecording(); return; }
    if (voiceEngine === "none") { setStatus(lang === "es" ? "Voz no disponible — escribe abajo" : "Voice unavailable — type below"); return; }
    const r = recRef.current;
    if (!r) { dbg("startListen: no recognition instance"); return; }
    finalRef.current = ""; textRef.current = ""; setText("");
    setStatus(lang === "es" ? "Escuchando…" : "Listening…");
    wantListenRef.current = true;
    setStillListening(false);
    if (stillListeningTimer.current) clearTimeout(stillListeningTimer.current);
    stillListeningTimer.current = setTimeout(() => {
      // If we're still recording with nothing finalised after 4s, tell Boris
      // we're not stuck — some browsers keep the mic hot with zero feedback.
      if (wantListenRef.current && !textRef.current) setStillListening(true);
    }, 4000);
    startMeter();
    try {
      r.start();
      setListening(true);
      dbg("start() called");
    } catch (err: any) {
      // Chrome throws InvalidStateError when start() is called on an already
      // running instance. Best recovery is to abort and try once more on the
      // next tick — quietly, no error UI unless the retry also fails.
      dbg("start() threw, retrying via abort+start", err?.message);
      try { r.abort(); } catch {}
      setTimeout(() => {
        try { r.start(); setListening(true); dbg("retry start() ok"); }
        catch (err2: any) {
          dbg("retry start() failed", err2?.message);
          setStatus(lang === "es" ? "No pude arrancar el micro — recarga la página." : "Couldn't start mic — reload the page.");
          setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
          wantListenRef.current = false;
        }
      }, 120);
    }
  }, [lang, voiceEngine, startWhisperRecording]);

  const stopAndSend = useCallback(() => {
    // FAB voice #3 — Whisper path: if editBeforeSend is OFF, flag the auto-send
    // so mr.onstop fires send() as soon as the final transcript replaces the
    // interim one. If ON (default), we just stop and wait for a manual send.
    if (voiceEngine === "whisper") {
      if (!editBeforeSend) autoSendPendingRef.current = true;
      stopWhisperRecording("user");
      return;
    }
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (stillListeningTimer.current) { clearTimeout(stillListeningTimer.current); stillListeningTimer.current = null; }
    setStillListening(false);
    stopMeter();
    wantListenRef.current = false;
    const r = recRef.current;
    if (r) {
      // stop() drains the pending result; abort() would DISCARD it. Boris
      // wants the words to survive the pause, so stop() is the right call.
      try { r.stop(); } catch {}
    }
    setListening(false);
    if (textRef.current.trim() && !editBeforeSend) send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceEngine, stopWhisperRecording, editBeforeSend]);
  // Keep the ref pointing at the freshest closure so the onresult silence
  // timer and onend callback both use the current send(), not the first-render
  // one they'd otherwise capture through useCallback([])'s stale scope.
  useEffect(() => { stopAndSendRef.current = stopAndSend; }, [stopAndSend]);

  const fabTap = () => {
    // FAB voice #3 — a plain tap now opens the VOICE PANEL, not the full
    // chat sheet. Boris was tapping to talk and instead getting the sheet
    // (which hides the transcript below the fold). Long-press still opens
    // the sheet for camera / wine / history.
    if (listening) { stopAndSend(); return; }
    if (!supported) { setOpen(true); return; } // no voice — fall back to sheet type-only
    userEditedRef.current = false;
    setLastPair(null);
    setVoicePanelOpen(true);
    startListen();
  };

  // Long-press → open sheet with camera actions strip (Collapse #2 redo)
  const fabPressDown = () => {
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      // Haptic
      if (navigator.vibrate) navigator.vibrate(15);
      setOpen(true);
    }, 500);
  };
  const fabPressUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (!longPressFired.current) fabTap();
  };
  const fabPressCancel = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const send = async () => {
    const t = (textRef.current.trim() || text.trim()); if (!t) return;
    setText(""); textRef.current = ""; finalRef.current = ""; setStatus("");
    userEditedRef.current = false;
    setLog((l) => [...l, { role: "you", text: t }, { role: "chef", text: "···", userText: t }]);
    setThinking(true);
    // FAB voice #3 — mini-chat continuity in the voice panel. Show the sent
    // message immediately, replace the "…" placeholder with the real reply
    // once /api/ask returns. lastPair is what the panel renders under the
    // transcript row so Boris sees the round-trip without opening the sheet.
    setSending(true);
    setLastPair({ you: t, chef: "" });
    // Sprint 3 · #3 — /grow/inbox integration. Pages can expose
    //   window.__fsAssistantInboxHooks.draftForHint(text) → { ok, ... }
    // and the FAB will run page-owned execution before falling through to the
    // orchestrator when the phrasing sounds like an email-draft request.
    //
    // Sprint 4 · #3 — the WhatsApp tab exposes __fsAssistantWhatsAppHooks with
    // the same shape. If the phrase mentions WhatsApp we prefer that hook.
    try {
      const waHooks = (typeof window !== "undefined" ? (window as any).__fsAssistantWhatsAppHooks : null) as any;
      const emailHooks = (typeof window !== "undefined" ? (window as any).__fsAssistantInboxHooks : null) as any;
      const onInbox = (pathname || "").startsWith("/grow/inbox");
      const looksLikeDraft = /\b(draft|reply|respond|answer|write|message|text)\b/i.test(t);
      const looksLikeWa = /\b(whatsapp|wa|voice ?note)\b/i.test(t);

      if (onInbox && looksLikeDraft && looksLikeWa && waHooks?.draftForHint) {
        const out = await waHooks.draftForHint(t);
        if (out?.ok) {
          const reply = (lang === "es" ? "Borrador de WhatsApp listo abajo" : "WhatsApp draft ready below")
            + (out.chat_id ? "\n" + (lang === "es" ? "Para +" : "To +") + out.chat_id : "");
          setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: "order", confidence: 1, userText: t }; return n; });
          setThinking(false);
          return;
        }
        // fall through if the WhatsApp hook couldn't handle it (e.g. no phone number in the phrase)
      }

      if (onInbox && emailHooks?.draftForHint && looksLikeDraft && !looksLikeWa) {
        const out = await emailHooks.draftForHint(t);
        if (out?.ok) {
          const reply = (lang === "es" ? "Borrador listo abajo — asunto: " : "Draft ready below — subject: ") + (out.subject || "(no subject)") + (out.from ? "\n" + (lang === "es" ? "Para " : "To ") + out.from : "");
          setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: "order", confidence: 1, userText: t }; return n; });
          setThinking(false);
          return;
        }
        // fall through if the hook couldn't handle it
      }

      // Bank reconciliation intent — "reconcile bank" / "match bank" / "run
      // reconciliation" runs the matcher server-side and reports the summary.
      // Cheap intent-recognition (regex) so the FAB doesn't have to round-trip
      // for a well-known operator phrase.
      const looksLikeRecon = /\b(reconcile|reconciliation|match)\b.*\b(bank|movements?|transacc?ions?)\b|\b(bank|movements?)\b.*\b(reconcile|match)\b|\brun\s+(the\s+)?matcher\b/i.test(t);
      if (looksLikeRecon) {
        const rawEnt = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
        const entityCode = rawEnt === "bistro_mondo" ? "BM" : rawEnt === "holdings" ? "BBH" : "IFL";
        const rr = await fetch("/api/finance/reconciliation/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity_code: entityCode, limit: 200 }),
        });
        const dd = await rr.json();
        if (dd?.ok && dd?.summary) {
          const s = dd.summary;
          const byType = Object.entries(s.by_type || {}).map(([k, v]) => k + ":" + v).join(", ") || "no candidates";
          const reply = (lang === "es"
            ? "Escaneé " + s.scanned + " movimientos · " + s.candidates_upserted + " candidatos · " + s.ai_fallbacks + " con IA. Revisa en /administrate/finance/reconciliation."
            : "Scanned " + s.scanned + " movements · " + s.candidates_upserted + " candidates · " + s.ai_fallbacks + " AI fallbacks. Triage them at /administrate/finance/reconciliation.")
            + "\n" + byType;
          setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: "order", confidence: 1, userText: t }; return n; });
          setThinking(false);
          return;
        }
      }
    } catch {}
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      // Pillars #1 — always pass active_pillar so the orchestrator knows
      // which world the user is in (FOH / BOH / Office). We merge it onto
      // the existing page_context so any page-set intent is preserved.
      const basePageCtx = (typeof window !== "undefined" ? (window as any).__fsAssistantContext : null) || {};
      const activePillar = pillarForRoute(pathname || "");
      const pageContextWithPillar = { ...basePageCtx, active_pillar: activePillar };
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        message: t, route: pathname || "", session_id: sessionRef.current, entity_id: ent, language: lang,
        page_context: pageContextWithPillar,
      })});
      const d = await r.json();
      const reply = d.reply || "…";
      const needsConfirm = d.intent && typeof d.confidence === "number" && d.confidence < CONFIDENCE_THRESHOLD;
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: d.intent, confidence: d.confidence, userText: t, turnId: d.user_turn_id, needsConfirm, memoryProposal: d.memory, orderDraft: d.order, feedback: d.feedback }; return n; });
      if (d.order) setOrderDraft(d.order);
      setLastPair({ you: t, chef: reply });
    } catch (e: any) {
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "sys", text: "⚠ " + (e?.message || "Chef offline") }; return n; });
      setLastPair({ you: t, chef: "⚠ " + (e?.message || (lang === "es" ? "Sin conexión" : "Chef offline")) });
      setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
    }
    setThinking(false);
    setSending(false);
  };

  const confirmIntent = async (msgIdx: number, confirmedIntent: string) => {
    const m = log[msgIdx]; if (!m?.userText) return;
    setLog((l) => l.map((x, i) => i === msgIdx ? { ...x, needsConfirm: false } : x));
    fetch("/api/chef/confirm-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: m.userText, classified_intent: m.intent, confirmed_intent: confirmedIntent, classifier_confidence: m.confidence, language: lang }) });
  };

  const saveMemory = async (msgIdx: number) => {
    const m = log[msgIdx]; if (!m?.memoryProposal?.fact) return;
    setLog((l) => l.map((x, i) => i === msgIdx ? { ...x, memoryProposal: null } : x));
    const r = await fetch("/api/chef/save-memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fact: m.memoryProposal.fact, scope: m.memoryProposal.scope || "global", source_conversation_id: m.turnId || null, confidence: m.confidence || null })});
    const d = await r.json();
    setLog((l) => [...l, { role: "sys", text: d.ok ? (lang === "es" ? "✓ Recordado" : "✓ Saved to memory") : ("⚠ " + (d.error || "save failed")) }]);
  };

  // Photo capture from long-press
  const onCapture = async (file?: File | null) => {
    if (!file) return;
    setLog((l) => [...l, { role: "sys", text: lang === "es" ? "📷 Subiendo…" : "📷 Uploading…" }]);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", "auto");
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (d.error || "upload failed") }]); return; }
      const det = d.detected;
      const summary = det ? `${d.type}${det.supplier_name ? " · " + det.supplier_name : ""}${det.total_eur != null ? " · €" + Number(det.total_eur).toFixed(2) : ""}` : d.type;
      setLog((l) => [...l, { role: "sys", text: `📷 ${lang === "es" ? "Archivado" : "Filed"}: ${summary} → ${d.where}` }]);
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "upload failed") }]); }
  };

  // Wine label scan — Collapse #2 second intent. Uses the same /api/wine-scan
  // endpoint the (now-deleted) /develop/wine/scan page used. Shows the extracted
  // wine in the sheet and hands off to the cellar for edit + full save.
  const onWineCapture = async (file?: File | null) => {
    if (!file) return;
    setWineBusy(true); setWineDraft(null);
    setLog((l) => [...l, { role: "sys", text: lang === "es" ? "🍷 Leyendo etiqueta…" : "🍷 Reading label…" }]);
    try {
      // Downscale in-browser (same recipe the old scan page used)
      const bmp = await new Promise<{ data: string; media_type: string }>((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1280; let { width, height } = img;
          if (width > max || height > max) { const sc = max / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
          const c = document.createElement("canvas"); c.width = width; c.height = height;
          c.getContext("2d")!.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url);
          resolve({ data: c.toDataURL("image/jpeg", 0.82).split(",")[1], media_type: "image/jpeg" });
        };
        img.onerror = reject; img.src = url;
      });
      const r = await fetch("/api/wine-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bmp) });
      const d = await r.json();
      if (!d.ok) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (d.error || "scan failed") }]); setWineBusy(false); return; }
      const w = d.wine || {};
      setWineDraft(w);
      const summary = [w.producer, w.name, w.vintage].filter(Boolean).join(" · ") || "wine";
      setLog((l) => [...l, { role: "sys", text: `🍷 ${lang === "es" ? "Etiqueta leída" : "Label read"}: ${summary}` }]);
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "scan failed") }]); }
    setWineBusy(false);
  };

  const saveWineDraft = async () => {
    if (!wineDraft?.name) return;
    setWineBusy(true);
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const rid = profile?.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      const sb = supabaseBrowser;
      const desc = [wineDraft.description, wineDraft.grape ? "Grape: " + wineDraft.grape : "", wineDraft.cuvee ? "Cuvée: " + wineDraft.cuvee : "", wineDraft.classification ? "Classification: " + wineDraft.classification : ""].filter(Boolean).join("\n\n") || null;
      const { data, error } = await sb.from("menu_items").insert({
        restaurant_id: rid, category: "drink", section: "wine",
        name: wineDraft.name, producer: wineDraft.producer || null, region: wineDraft.region || null, vintage: wineDraft.vintage || null,
        wine_style: wineDraft.wine_style || "to_classify",
        tasting_notes: wineDraft.tasting_notes || null, pitch: wineDraft.pitch || null,
        description: desc, is_active: false,
      }).select("id").maybeSingle();
      if (error) { setLog((l) => [...l, { role: "sys", text: "⚠ " + error.message }]); setWineBusy(false); return; }
      const id = data?.id;
      setWineDraft(null);
      setLog((l) => [...l, { role: "sys", text: (lang === "es" ? "✓ Borrador guardado en la bodega. " : "✓ Draft saved to cellar. ") }]);
      if (id) window.location.href = `/develop/wine/${id}`;
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "save failed") }]); }
    setWineBusy(false);
  };

  // Bottom-sheet drag
  const onHandleDown = (e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = { y: e.clientY, height: sheetRef.current.clientHeight };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !sheetRef.current) return;
    const dy = e.clientY - dragStart.current.y;
    const h = Math.max(80, dragStart.current.height - dy);
    sheetRef.current.style.height = h + "px";
  };
  const onHandleUp = () => {
    if (!dragStart.current || !sheetRef.current) return;
    const vh = window.innerHeight;
    const ratio = sheetRef.current.clientHeight / vh;
    if (ratio < 0.25) { setOpen(false); sheetRef.current.style.height = ""; dragStart.current = null; return; }
    // Snap to nearest
    let best = 0, bestDelta = Infinity;
    SNAP_POINTS.forEach((p, i) => { const d = Math.abs(ratio - p); if (d < bestDelta) { bestDelta = d; best = i; } });
    setSnap(best);
    sheetRef.current.style.height = (SNAP_POINTS[best] * vh) + "px";
    dragStart.current = null;
  };

  // Hardware/browser back closes
  useEffect(() => {
    if (!open) return;
    const onPop = () => setOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  // Assistant Polish #1 — quietly distil the finished chat into memory.
  // Fires on FAB close and on navigation-away. Session id is the boundary;
  // the extractor short-circuits below 2 user turns and rate-limits per
  // session so this is safe to over-fire. Fire-and-forget — the response
  // does not block the UI.
  useEffect(() => {
    userTurnCountRef.current = log.filter((m) => m.role === "you").length;
  }, [log]);

  const fireExtract = useCallback(() => {
    const sid = sessionRef.current;
    if (!sid) return;
    if (lastExtractRef.current === sid) return;
    if (userTurnCountRef.current < 2) return;
    lastExtractRef.current = sid;
    const ent = (!profile?.isAdmin ? profile?.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
    const ENTITY_CODE: Record<string, "IFL"|"BM"|"BBH"> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };
    const entity_code = ENTITY_CODE[ent as string] || "IFL";
    try {
      fetch("/api/assistant/memory/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ session_id: sid, entity: entity_code }),
      }).catch(() => {});
    } catch {}
  }, [profile]);

  // Trigger extraction when the sheet transitions open → closed.
  useEffect(() => {
    if (open) return;
    fireExtract();
  }, [open, fireExtract]);

  // Trigger extraction on navigation-away (pathname changes).
  useEffect(() => {
    return () => { fireExtract(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Also fire on tab hide, so a browser close doesn't lose the session.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => { if (document.visibilityState === "hidden") fireExtract(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fireExtract]);

  if (hidden) return null;

  const ringClass = errorPulse ? "ring-4 ring-tomato animate-pulse" : listening ? "ring-4 ring-white/70 animate-pulse" : thinking ? "ring-4 ring-white/40" : open ? "ring-2 ring-white/70" : "";
  const label = errorPulse ? "!" : listening ? "···" : thinking ? "···" : "Chef";

  return (
    <>
      <input ref={captureInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onCapture(e.target.files?.[0])} />
      <input ref={wineInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onWineCapture(e.target.files?.[0])} />

      <button
        aria-label="Chef — tap to talk · hold to open"
        style={{ background: errorPulse ? "#9A3122" : "var(--accent)", touchAction: "manipulation" }}
        className={"fixed bottom-5 right-5 z-[60] h-16 w-16 select-none rounded-full font-serif text-[15px] text-[#F7F7F4] shadow-lg shadow-black/25 transition active:scale-95 " + ringClass}
        onPointerDown={fabPressDown}
        onPointerUp={fabPressUp}
        onPointerCancel={fabPressCancel}
        onPointerLeave={fabPressCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>

      {voicePanelOpen ? (
        <div
          role="dialog"
          aria-label={lang === "es" ? "Panel de voz" : "Voice panel"}
          className="fixed z-[55] flex flex-col gap-3 border border-black/10 bg-paper p-3 shadow-2xl shadow-black/25 md:right-6 md:bottom-24 md:w-[380px] md:rounded-2xl inset-x-0 bottom-24 mx-0"
          style={{
            // Editorial identity — hairline, not soft card. On mobile the
            // panel is a full-width bottom bar; on desktop a floating right
            // card that doesn't cover main content.
            borderColor: "var(--line, rgba(0,0,0,.12))",
          }}
        >
          {/* Header: engine chip + lang selector + close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className="rounded-full border border-line bg-paper-deep/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-clay"
                aria-label={lang === "es" ? "motor de voz" : "voice engine"}
              >
                {voiceEngine === "whisper" ? "Whisper" : voiceEngine === "web-speech" ? "Web Speech" : (lang === "es" ? "Fallback" : "Fallback")}
              </span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as "en" | "es" | "da")}
                aria-label={lang === "es" ? "idioma" : "language"}
                className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink outline-none focus:border-ink"
              >
                <option value="en">EN</option>
                <option value="es">ES</option>
                <option value="da">DA</option>
              </select>
              {listening ? (
                <span
                  className="ml-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-clay"
                  aria-live="polite"
                >
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                  {lang === "es" ? "Escuchando" : "Listening"}
                </span>
              ) : transcribing ? (
                <span
                  className="ml-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-clay"
                  aria-live="polite"
                >
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                  {lang === "es" ? "Transcribiendo" : "Transcribing"}
                </span>
              ) : sending ? (
                <span
                  className="ml-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-clay"
                  aria-live="polite"
                >
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                  {lang === "es" ? "Enviando" : "Sending"}
                </span>
              ) : null}
            </div>
            <button
              onClick={() => {
                // Cancel any in-flight recording and close the panel.
                if (voiceEngine === "whisper") stopWhisperRecording("cancel");
                else {
                  try { recRef.current?.abort?.(); } catch {}
                  setListening(false);
                  stopMeter();
                  wantListenRef.current = false;
                }
                if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
                autoSendPendingRef.current = false;
                setVoicePanelOpen(false);
                setStatus("");
                setText(""); textRef.current = ""; finalRef.current = "";
                userEditedRef.current = false;
                setLastPair(null);
              }}
              aria-label={lang === "es" ? "cerrar" : "close"}
              className="font-mono text-[14px] leading-none text-clay hover:text-ink"
            >
              ×
            </button>
          </div>

          {/* Amplitude meter — 12 segments */}
          <div className="flex h-2.5 items-center gap-[3px]" aria-label={lang === "es" ? "nivel del micro" : "microphone level"}>
            {Array.from({ length: 12 }).map((_, i) => {
              const threshold = (i + 1) / 12;
              const on = listening && amplitude >= threshold - 0.06;
              return (
                <span
                  key={i}
                  className="h-full flex-1 rounded-full transition-opacity"
                  style={{ background: "var(--accent)", opacity: on ? 0.9 : 0.15 }}
                />
              );
            })}
          </div>

          {/* Big editable transcript textbox */}
          <textarea
            ref={panelTextareaRef}
            value={text}
            onChange={(e) => {
              userEditedRef.current = true;
              setText(e.target.value); textRef.current = e.target.value; finalRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              // Accessibility — ⌘⏎ / Ctrl⏎ sends from the transcript box.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (listening) { stopAndSend(); }
                else if (text.trim()) { void send(); }
              }
            }}
            rows={3}
            placeholder={
              listening
                ? (lang === "es" ? "Habla… el texto aparecerá aquí" : "Speak… your words will appear here")
                : (lang === "es" ? "Toca el micro y habla — o escribe aquí" : "Tap the mic and speak — or type here")
            }
            aria-label={lang === "es" ? "Transcripción" : "Transcript"}
            className="min-h-[72px] w-full resize-none border border-line bg-paper-deep/20 px-3 py-2 font-serif text-[16px] leading-relaxed text-ink outline-none focus:border-ink"
            style={{ borderColor: "var(--line, rgba(0,0,0,.12))" }}
          />

          {/* Status line — small live-region for screen readers */}
          {status ? (
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay" aria-live="polite">{status}</p>
          ) : null}
          {micDenied ? (
            <p className="font-mono text-[10px] uppercase tracking-wide text-tomato">
              {lang === "es"
                ? "Micro bloqueado. iOS: Ajustes → Safari → Micrófono → Permitir."
                : "Mic blocked. iOS: Settings → Safari → Microphone → Allow."}
            </p>
          ) : null}

          {/* Bottom actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                if (listening) {
                  // Stop & (optionally) Send. Whisper waits for the final
                  // transcription before send() fires — handled in mr.onstop
                  // via autoSendPendingRef.
                  if (!editBeforeSend) autoSendPendingRef.current = true;
                  stopAndSend();
                } else if (text.trim()) {
                  void send();
                }
              }}
              disabled={sending || transcribing || (!listening && !text.trim())}
              style={{ background: "var(--ink, #1a1a1a)" }}
              className="rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40"
              aria-label={listening ? (lang === "es" ? "Detener y enviar" : "Stop and send") : (lang === "es" ? "Enviar" : "Send")}
            >
              {listening ? (editBeforeSend ? (lang === "es" ? "■ detener" : "■ stop") : (lang === "es" ? "■ enviar" : "■ stop & send")) : sending ? (lang === "es" ? "enviando…" : "sending…") : (lang === "es" ? "↑ enviar" : "↑ send")}
            </button>
            <button
              onClick={() => {
                if (voiceEngine === "whisper") stopWhisperRecording("cancel");
                else {
                  try { recRef.current?.abort?.(); } catch {}
                  setListening(false);
                  stopMeter();
                  wantListenRef.current = false;
                }
                if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
                autoSendPendingRef.current = false;
                setText(""); textRef.current = ""; finalRef.current = "";
                userEditedRef.current = false;
                setStatus("");
                setVoicePanelOpen(false);
                setLastPair(null);
              }}
              className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft"
              aria-label={lang === "es" ? "cancelar" : "cancel"}
            >
              × {lang === "es" ? "cancelar" : "cancel"}
            </button>
            <button
              onClick={() => {
                // Restart — cancel current, wipe transcript, kick a fresh session.
                if (voiceEngine === "whisper") stopWhisperRecording("cancel");
                else {
                  try { recRef.current?.abort?.(); } catch {}
                  setListening(false);
                }
                if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
                autoSendPendingRef.current = false;
                setText(""); textRef.current = ""; finalRef.current = "";
                userEditedRef.current = false;
                setStatus("");
                setTimeout(() => { if (supported) startListen(); }, 120);
              }}
              className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft"
              aria-label={lang === "es" ? "reiniciar" : "restart"}
            >
              ↻ {lang === "es" ? "reiniciar" : "restart"}
            </button>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-clay">
              <input
                type="checkbox"
                checked={editBeforeSend}
                onChange={(e) => setEditBeforeSend(e.target.checked)}
                className="h-3 w-3 accent-ink"
                aria-label={lang === "es" ? "editar antes de enviar" : "edit before send"}
              />
              ⇧ {lang === "es" ? "editar antes de enviar" : "edit before send"}
            </label>
          </div>

          {/* Mini-chat continuity — last sent + reply */}
          {lastPair ? (
            <div className="mt-1 border-t border-line pt-2">
              <p className="font-mono text-[9px] uppercase tracking-wide text-clay">{lang === "es" ? "Tú" : "You"}</p>
              <p className="mt-0.5 whitespace-pre-line font-serif text-[14px] leading-snug text-ink">{lastPair.you}</p>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-wide text-clay">Chef</p>
              <p className="mt-0.5 whitespace-pre-line font-serif text-[14px] leading-snug text-ink-soft">
                {lastPair.chef || (sending ? (lang === "es" ? "pensando…" : "thinking…") : "")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    // + New question — clear the pair, wipe transcript, start listening again.
                    setLastPair(null);
                    setText(""); textRef.current = ""; finalRef.current = "";
                    userEditedRef.current = false;
                    setStatus("");
                    if (supported) startListen();
                  }}
                  className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper"
                >
                  + {lang === "es" ? "nueva pregunta" : "new question"}
                </button>
                <button
                  onClick={() => { setOpen(true); }}
                  className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft"
                >
                  {lang === "es" ? "ver historial →" : "open history →"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div ref={sheetRef} className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-black/10 bg-card shadow-2xl shadow-black/25" style={{ height: (SNAP_POINTS[snap] * 100) + "vh" }}>
            <div className="flex items-center justify-between px-4 pt-2 pb-1" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Chef</span>
              <div className="mx-auto h-1 w-9 rounded-full bg-black/15" />
              <button onClick={() => setOpen(false)} aria-label="close" className="font-mono text-[11px] text-clay hover:text-ink">×</button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
              {log.length === 0 && !text ? (
                <div>
                  <p className="font-serif text-[16px] leading-relaxed text-clay">
                    {lang === "es" ? "Toca Chef y habla. Pausa para enviar." : "Tap Chef and talk. Pause to send."} {" "}
                    <span className="text-muted">{lang === "es" ? "Mantén pulsado = cámara." : "Hold the button = camera."}</span>
                  </p>
                </div>
              ) : null}
              {/* Camera actions strip (Collapse #2 wiring) — always visible when sheet is open */}
              <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-3">
                <button onClick={() => captureInputRef.current?.click()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">📷 {lang === "es" ? "Capturar factura / EOD" : "Capture doc / EOD"}</button>
                <button onClick={() => wineInputRef.current?.click()} disabled={wineBusy} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-50">🍷 {wineBusy ? (lang === "es" ? "leyendo…" : "reading…") : (lang === "es" ? "Escanear vino" : "Scan wine")}</button>
              </div>
              {wineDraft ? (
                <div className="mb-4 rounded-xl border border-line bg-paper-deep/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "Vino leído" : "Wine label read"}</p>
                  <p className="mt-1 font-serif text-[15px] text-ink">{[wineDraft.producer, wineDraft.name, wineDraft.vintage].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="mt-1 font-mono text-[10px] text-clay">{[wineDraft.region, wineDraft.wine_style].filter(Boolean).join(" · ")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={saveWineDraft} disabled={wineBusy || !wineDraft.name} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">{wineBusy ? (lang === "es" ? "guardando…" : "saving…") : (lang === "es" ? "✓ guardar borrador · abrir" : "✓ save draft · open")}</button>
                    <button onClick={() => setWineDraft(null)} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink">× {lang === "es" ? "descartar" : "dismiss"}</button>
                  </div>
                </div>
              ) : null}
              {log.map((m, i) => m.role === "sys"
                ? <p key={i} className="mb-3 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{m.text}</p>
                : (
                  <div key={i} className="mb-3">
                    <p className={"whitespace-pre-line font-serif text-[17px] leading-relaxed " + (m.role === "you" ? "text-ink" : "text-ink-soft")}>{m.text}</p>
                    {m.needsConfirm ? (
                      <div className="mt-2 rounded-xl border border-line bg-paper p-2">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "¿Qué pediste? Toca para confirmar — me ayuda a aprender." : "What did you mean? Tap to confirm — helps me learn."}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {["ask","order","feedback","memory","capture"].map((opt) => (
                            <button key={opt} onClick={() => confirmIntent(i, opt)} className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${m.intent === opt ? "border-ink bg-paper-deep" : "border-line bg-paper hover:border-ink-soft"}`}>{opt}</button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {m.memoryProposal?.fact ? (
                      <div className="mt-2 rounded-xl border border-line bg-paper-deep/40 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "¿Recordar?" : "Remember?"}</p>
                        <p className="mt-1 font-serif italic text-[14px] text-ink">{m.memoryProposal.fact}</p>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => saveMemory(i)} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">{lang === "es" ? "✓ guardar" : "✓ save"}</button>
                          <button onClick={() => setLog((l) => l.map((x, j) => j === i ? { ...x, memoryProposal: null } : x))} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink">{lang === "es" ? "× descartar" : "× dismiss"}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              {text ? (
                <p className="font-serif text-[17px] leading-relaxed text-ink">
                  {text}
                  {listening ? <span className="ml-1 inline-block h-[1em] w-[2px] animate-pulse bg-ink align-middle" /> : null}
                </p>
              ) : null}
              {listening ? (
                <div className="mt-3 flex items-center gap-3">
                  {/* Live amplitude bar — 12 segments, filled proportionally.
                      This is our waveform stand-in until we ship a proper canvas. */}
                  <div className="flex h-3 flex-1 items-center gap-[3px]" aria-label="microphone level">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const threshold = (i + 1) / 12;
                      const on = amplitude >= threshold - 0.06;
                      return (
                        <span
                          key={i}
                          className="h-full flex-1 rounded-full transition-opacity"
                          style={{ background: "var(--accent)", opacity: on ? 0.9 : 0.15 }}
                        />
                      );
                    })}
                  </div>
                  <button
                    onClick={() => stopAndSend()}
                    className="shrink-0 rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper"
                    aria-label={lang === "es" ? "Detener y enviar" : "Stop and send"}
                  >
                    {lang === "es" ? "■ enviar" : "■ send"}
                  </button>
                </div>
              ) : null}
              {listening && stillListening ? (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                  {lang === "es" ? "Sigo escuchando… habla cuando quieras." : "Still listening… speak whenever you're ready."}
                </p>
              ) : null}
              {transcribing ? (
                <p className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} aria-hidden />
                  {lang === "es" ? "Transcribiendo con Whisper…" : "Transcribing with Whisper…"}
                </p>
              ) : null}
              {micDenied ? (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-tomato">
                  {lang === "es"
                    ? "Micro bloqueado. iOS: Ajustes → Safari → Micrófono → Permitir. Chrome: candado en la barra."
                    : "Mic blocked. iOS: Settings → Safari → Microphone → Allow. Chrome: click the padlock in the address bar."}
                </p>
              ) : null}
            </div>

            {orderDraft ? (
              <button onClick={() => { localStorage.setItem("fs_order_draft", JSON.stringify(orderDraft)); window.location.href = "/execute/orders"; }} style={{ background: "var(--accent)" }} className="mx-3 mb-2 rounded-xl px-4 py-2.5 text-center font-sans text-[13px] font-medium text-[#F7F7F4]">{lang === "es" ? "Borrador en Pedidos →" : "Draft this order in Ordering →"}</button>
            ) : null}

            <div className="flex items-center gap-3 border-t border-black/10 p-3">
              <input value={text} onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; }} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={lang === "es" ? "…o escribe a Chef" : "…or type to Chef"} className="min-w-0 flex-1 rounded-full border border-black/15 bg-paper px-4 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink" />
              {text ? <button onClick={send} style={{ background: "var(--accent)" }} className="shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4]">{lang === "es" ? "Enviar" : "Send"}</button> : null}
            </div>
            <p className="px-4 pb-2 text-center font-mono text-[9px] uppercase tracking-wide text-clay">{status || (supported ? (lang === "es" ? "Toca Chef · mantén = cámara" : "Tap Chef · hold to open") : (lang === "es" ? "Escribe arriba — voz mejor en Chrome" : "Type above — voice works best in Chrome"))}{voiceEngine !== "none" ? (voiceEngine === "whisper" ? " · Whisper" : " · Web Speech") : ""}</p>
          </div>
        </>
      ) : null}
    </>
  );
}
