"use client";

// Headset / media-key push-to-talk — Chef v3 Phase 2 S5.
//
// Used by ChefRoot on the wall screen at the pass (/h/[house]/pass, body
// [data-chef-mode="pass"]). `onToggle` is exactly a tap on the Chef circle:
// idle → listening, listening → stop. Three input paths feed it:
//
//   (a) keyboard — Space / Enter (outside an editable element) and the
//       MediaPlayPause / MediaTrackNext keys. Covers a BT keyboard, a USB
//       foot switch that emits Space, and headsets whose button is exposed
//       as a media key.
//   (b) Media Session — navigator.mediaSession action handlers for play /
//       pause / nexttrack / previoustrack. This is how an AVRCP button on a
//       Bluetooth headset reaches a web page.
//   (c) audio session — a page only receives media-key / AVRCP events while
//       it is the active audio session, so on the first user gesture after
//       enable we start a silent looping <audio> (1 s WAV of silence built
//       at runtime, volume 0.01) and set MediaMetadata so the OS shows
//       "Chef · Food Studio OS" as the now-playing source.
//
// iPad Safari — KNOWN vs UNVERIFIED (nothing below was tested on a physical
// iPad from this environment; the wall screen is the first real test):
//   KNOWN      MediaSession action handlers exist on iOS/iPadOS Safari since
//              iOS 15 (play, pause, nexttrack, previoustrack are all in the
//              supported set).
//   KNOWN      keydown from a Bluetooth keyboard reaches the page normally;
//              Space / Enter here work without any audio session.
//   KNOWN      autoplay policy: the silent loop cannot start without a user
//              gesture, hence the one-shot pointerdown/keydown listener.
//   UNVERIFIED AVRCP play/pause from a BT headset is delivered as the
//              'play' / 'pause' Media Session actions ONLY while the page is
//              the active audio session — the silent loop is what should
//              provide that after the gesture. Whether iPadOS routes the
//              headset button to Safari (vs. Music) while our loop plays at
//              volume 0.01 is not confirmed.
//   UNVERIFIED Safari may pause the silent loop when the tab is backgrounded
//              or the screen locks; on return the loop may need a fresh
//              gesture. We re-arm the gesture listener when playback is
//              found paused on visibilitychange.
//   UNVERIFIED whether Safari fires 'pause' (rather than swallowing it) when
//              the headset button is pressed while the loop is playing — we
//              bind both 'play' and 'pause' to the same toggle so either
//              order works.
//
// `onToggle` is held in a ref so the DOM / Media Session handlers never go
// stale across ChefRoot renders. Everything is torn down on disable/unmount:
// listeners removed, action handlers nulled, audio paused and released.

import { useEffect, useRef } from "react";

const MEDIA_KEYS = new Set(["MediaPlayPause", "MediaTrackNext", "MediaPlay", "MediaPause"]);
const ACTIONS = ["play", "pause", "nexttrack", "previoustrack"] as const;

function isEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || typeof n.tagName !== "string") return false;
  const tag = n.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!n.isContentEditable;
}

// 1 s of 8 kHz 8-bit mono PCM silence, as a data URI. Built once per
// module load (~10 KB base64) rather than pasted in as a literal.
let silentWavUri: string | null = null;
function silentWav(): string {
  if (silentWavUri) return silentWavUri;
  const rate = 8000, samples = rate; // 1 s
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, samples, true);
  // 8-bit PCM silence is 0x80 (unsigned midpoint), not 0x00.
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 0x80);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  silentWavUri = "data:audio/wav;base64," + btoa(bin);
  return silentWavUri;
}

function mediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function useHeadsetPTT(enabled: boolean, onToggle: () => void): { supported: boolean } {
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const fire = () => { try { toggleRef.current(); } catch { /* never let a handler throw into the DOM */ } };

    // (a) keyboard
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (MEDIA_KEYS.has(e.key)) { e.preventDefault(); fire(); return; }
      if ((e.key === " " || e.key === "Enter" || e.code === "Space") && !isEditable(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);

    // (b) Media Session action handlers
    const ms = mediaSessionSupported() ? navigator.mediaSession : null;
    if (ms) {
      for (const a of ACTIONS) {
        try { ms.setActionHandler(a, () => fire()); } catch { /* action not supported on this UA */ }
      }
      try {
        if (typeof MediaMetadata !== "undefined") ms.metadata = new MediaMetadata({ title: "Chef", artist: "Food Studio OS" });
      } catch { /* metadata optional */ }
    }

    // (c) silent audio session, started on the first gesture
    let audio: HTMLAudioElement | null = null;
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      window.addEventListener("pointerdown", onGesture, { once: true, capture: true });
      window.addEventListener("keydown", onGesture, { once: true, capture: true });
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
    };
    const startLoop = () => {
      try {
        if (!audio) {
          audio = new Audio(silentWav());
          audio.loop = true;
          audio.volume = 0.01;
          audio.setAttribute("playsinline", "");
        }
        const p = audio.play();
        if (p && typeof p.then === "function") {
          p.then(
            () => { if (ms) { try { ms.playbackState = "playing"; } catch { /* ignore */ } } },
            () => { arm(); }, // gesture not accepted (autoplay policy) — wait for the next one
          );
        }
      } catch { arm(); }
    };
    function onGesture() { disarm(); startLoop(); }
    // Safari may pause the loop when backgrounded (UNVERIFIED) — re-arm so
    // the next gesture restarts it instead of leaving the headset deaf.
    const onVis = () => { if (document.visibilityState === "visible" && audio && audio.paused) arm(); };
    document.addEventListener("visibilitychange", onVis);
    arm();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      disarm();
      if (ms) {
        for (const a of ACTIONS) { try { ms.setActionHandler(a, null); } catch { /* ignore */ } }
        try { ms.metadata = null; } catch { /* ignore */ }
        try { ms.playbackState = "none"; } catch { /* ignore */ }
      }
      if (audio) {
        try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* ignore */ }
        audio = null;
      }
    };
  }, [enabled]);

  return { supported: mediaSessionSupported() };
}
