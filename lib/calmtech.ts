"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * calm-tech foundation — reusable primitives for FS OS under tough service conditions.
 * Wake lock (screen stays awake), haptics (felt confirmation), speech (read-aloud),
 * and voice commands (hands-free control). All guarded for SSR + unsupported devices.
 */

// --- Wake Lock: keep the screen awake while a task screen is open ---
export function useWakeLock(active: boolean = true) {
  const ref = useRef<any>(null);
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    let cancelled = false;
    const request = async () => {
      try {
        const nav: any = navigator;
        if (nav.wakeLock?.request) ref.current = await nav.wakeLock.request("screen");
      } catch {}
    };
    request();
    const onVis = () => {
      if (document.visibilityState === "visible" && !cancelled) request();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { ref.current?.release?.(); } catch {}
      ref.current = null;
    };
  }, [active]);
}

// --- Haptics: a buzz for confirmation. (iOS Safari ignores navigator.vibrate;
//     on iPhones the wrist/Apple Watch is the haptic channel instead.) ---
export const HAPTIC = {
  tap: 18,
  confirm: [16, 40, 16] as number[],
  done: [24, 60, 24, 60, 40] as number[],
};
export function haptic(pattern: number | number[] = HAPTIC.tap) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as any).vibrate(pattern);
    }
  } catch {}
}

// --- Speech synthesis: read text aloud (eyes-free) ---
export function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const speak = useCallback((text: string) => {
    if (!supported || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.96;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }, [supported]);
  const stop = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch {}
  }, []);
  return { supported, speak, stop };
}

// --- Voice commands: hands-free control via Web Speech recognition ---
type CommandMap = Record<string, () => void>;
export function useVoiceCommands(commands: CommandMap, enabled: boolean) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const cmdRef = useRef(commands);
  cmdRef.current = commands;
  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    if (!enabled || !supported) { setListening(false); return; }
    const w: any = window;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const said = String(e.results[e.results.length - 1][0].transcript || "")
        .toLowerCase()
        .trim();
      for (const key of Object.keys(cmdRef.current)) {
        if (said.includes(key)) { cmdRef.current[key](); break; }
      }
    };
    rec.onend = () => { if (enabled) { try { rec.start(); } catch {} } };
    rec.onerror = () => {};
    try { rec.start(); setListening(true); } catch {}
    recRef.current = rec;
    return () => {
      try { rec.onend = null; rec.stop(); } catch {}
      setListening(false);
    };
  }, [enabled, supported]);

  return { listening, supported };
}

// --- One-shot dictation: capture a single spoken phrase, resolve the transcript. ---
export function speechSupported(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}
export function dictateOnce(lang: string = "en-US"): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!speechSupported()) { reject(new Error("speech-unsupported")); return; }
    const w: any = window;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    rec.onresult = (e: any) => { done = true; resolve(String(e.results[0][0].transcript || "").trim()); };
    rec.onerror = (e: any) => { if (!done) reject(new Error(e?.error || "speech-error")); };
    rec.onend = () => { if (!done) reject(new Error("no-speech")); };
    try { rec.start(); } catch (err) { reject(err as Error); }
  });
}
