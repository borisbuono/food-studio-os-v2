"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { isStandalone, detectPlatform, Platform } from "@/lib/pwa/install";

// PWA #3 (2026-07-28) — read-only engine indicator for the assistant
// settings page. Reports which voice engine is live on THIS device, so an
// operator can quickly tell whether they're on Whisper (iOS / installed
// PWA) or Web Speech (desktop Chrome) and whether the app is installed.
// Also surfaces an install nudge when the app isn't standalone yet.

type Engine = "web-speech" | "whisper" | "none";

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && (navigator as any).maxTouchPoints > 1);
}

function pickEngine(): Engine {
  if (typeof window === "undefined") return "none";
  const w = window as any;
  const hasWebSpeech = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const hasMediaRecorder = typeof w.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  if (detectIOS() && hasMediaRecorder) return "whisper";
  if (hasWebSpeech) return "web-speech";
  if (hasMediaRecorder) return "whisper";
  return "none";
}

const ENGINE_LABEL: Record<Engine, string> = {
  "web-speech": "Web Speech (native browser)",
  whisper: "OpenAI Whisper (server-side)",
  none: "Voice unavailable",
};

const ENGINE_BLURB: Record<Engine, string> = {
  "web-speech": "Fast, free, in-browser. Best on Chrome and Edge desktop.",
  whisper: "Server-side transcription — reliable on iOS and any browser where native voice is broken. Small per-second cost, metered to your entity.",
  none: "This browser exposes neither Web Speech nor MediaRecorder. Try Chrome, Safari 14+, or install FS OS as an app.",
};

export default function VoiceEngineIndicator() {
  const [engine, setEngine] = useState<Engine>("none");
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setEngine(pickEngine());
    setStandalone(isStandalone());
    setPlatform(detectPlatform());
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-3 border-b border-line pb-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Engine</span>
        <span className="font-serif text-[15px] text-ink">{ENGINE_LABEL[engine]}</span>
      </div>
      <p className="mt-2 font-serif italic text-[14px] leading-relaxed text-ink-soft">{ENGINE_BLURB[engine]}</p>

      <div className="mt-4 flex flex-wrap items-baseline gap-3 border-b border-line pb-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Installed</span>
        <span className="font-serif text-[15px] text-ink">
          {standalone ? "Yes — running as an installed app" : "No — running in browser tab"}
        </span>
      </div>
      {!standalone ? (
        <p className="mt-2 font-serif italic text-[14px] leading-relaxed text-ink-soft">
          Installing FS OS makes iOS treat it as a real app: mic permission persists across sessions, the app shows up in your device settings, and the voice engine won't cut off on the first pause.{" "}
          <Link href="/install" className="border-b border-ink/40 pb-[1px] text-ink">See install steps for {platform === "ios-safari" ? "iPhone Safari" : platform === "android-chrome" ? "Android" : platform === "desktop-chrome" ? "Chrome" : "your browser"} →</Link>
        </p>
      ) : null}
    </div>
  );
}
