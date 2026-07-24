"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isStandalone, detectPlatform, canInstall, Platform } from "@/lib/pwa/install";

// PWA #1 (2026-07-28) — the "Install FS OS" nudge that lives at the top of
// Home when the app is running in the browser (not standalone) on a supported
// platform. Dismissible for 7 days per browser via localStorage. Deliberately
// small and quiet — Boris hates hectoring UI.
//
// Only rendered on /, /develop, /execute, /administrate, /grow — the entry
// points. On deep pages we don't distract.

const DISMISS_KEY = "fs_pwa_install_dismissed_at";
const RE_NUDGE_DAYS = 7;

function isEntryRoute(path: string): boolean {
  if (path === "/" || path === "") return true;
  return path === "/develop" || path === "/execute" || path === "/administrate" || path === "/grow";
}

export default function InstallPrompt() {
  const pathname = usePathname() || "";
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return; // already installed
    const p = detectPlatform();
    setPlatform(p);
    if (!canInstall(p)) return;
    if (!isEntryRoute(pathname)) return;
    // Suppress the strip if the user dismissed it within the last week.
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && Date.now() - ts < RE_NUDGE_DAYS * 86_400_000) return;
      }
    } catch {}
    // Wait a beat so the strip doesn't flash before the compass renders.
    const id = setTimeout(() => setVisible(true), 900);
    return () => clearTimeout(id);
  }, [pathname]);

  if (!visible) return null;

  const platformCopy =
    platform === "ios-safari" ? "Tap Share, then Add to Home Screen."
      : platform === "ios-chrome" ? "Open in Safari, then Share → Add to Home Screen."
      : platform === "android-chrome" ? "Tap the menu, then Install app."
      : platform === "desktop-chrome" ? "Click the install icon in the address bar."
      : platform === "desktop-safari" ? "File → Add to Dock."
      : "Add FS OS to your device.";

  return (
    <div className="mx-auto mt-3 flex max-w-xl items-center gap-3 rounded-xl border border-line bg-paper-deep/50 px-4 py-2.5"
      role="status" aria-live="polite">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Install FS OS</p>
        <p className="mt-0.5 font-serif text-[14px] italic text-ink-soft">{platformCopy}</p>
      </div>
      <Link href="/install"
        className="shrink-0 rounded-full border border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper">
        How
      </Link>
      <button
        onClick={() => {
          try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
          setVisible(false);
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded-full border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
