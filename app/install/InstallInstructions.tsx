"use client";
import { useEffect, useState } from "react";
import { detectPlatform, platformLabel, isStandalone, Platform } from "@/lib/pwa/install";

// PWA #1 (2026-07-28) — client-side platform detection + step lists. We show
// the matched platform's steps at the top, then fold every other platform
// into a collapsible section so the page still reads as a single reference.

type Steps = { title: string; body: string }[];

const IOS_SAFARI_STEPS: Steps = [
  { title: "Open FS OS in Safari", body: "This must be Safari on iPhone or iPad — Chrome and Firefox can't install web apps on iOS." },
  { title: "Tap the Share icon", body: "The square with the up-arrow, at the bottom of the screen (iPhone) or the top-right (iPad)." },
  { title: "Scroll to \"Add to Home Screen\"", body: "iOS will offer to name it — leave it as \"FS OS\" and tap Add." },
  { title: "Launch from the Home Screen", body: "FS OS now opens fullscreen. First voice tap will ask for the mic — allow once and it stays granted." },
];

const IOS_CHROME_STEPS: Steps = [
  { title: "iOS installs from Safari only", body: "Even if you use Chrome or Firefox on iPhone, the install path runs through Safari. Copy the FS OS URL, open Safari, then follow the Safari steps." },
];

const ANDROID_STEPS: Steps = [
  { title: "Open FS OS in Chrome", body: "Edge, Samsung Internet, and Brave also work — any Chromium browser." },
  { title: "Tap the menu (⋮)", body: "Look for \"Install app\" or \"Add to Home screen\"." },
  { title: "Confirm the install", body: "FS OS lands in your app drawer and behaves like any native app." },
  { title: "Launch and allow mic", body: "First voice tap requests the mic — the grant sticks." },
];

const DESKTOP_CHROME_STEPS: Steps = [
  { title: "Look for the install icon", body: "In the right side of the address bar — a small computer with a down arrow, or a puzzle-piece install button." },
  { title: "Click Install", body: "FS OS opens in its own window, appears in your dock/taskbar, and gets a persistent shortcut." },
  { title: "Alternate: menu → Install FS OS", body: "If the address-bar icon isn't there, the three-dot menu offers the same action under \"Cast, save, and share\"." },
];

const DESKTOP_SAFARI_STEPS: Steps = [
  { title: "Update to Safari 17 or newer", body: "\"Add to Dock\" landed in macOS Sonoma. Older Safari can't install web apps." },
  { title: "File → Add to Dock", body: "Or use the Share button (top of the window). Give it a name and it lands in your Dock." },
  { title: "Launch from the Dock", body: "Runs in its own window with its own menu bar." },
];

const FIREFOX_STEPS: Steps = [
  { title: "Firefox can't install PWAs today", body: "The web app manifest is honoured for the icon and theme, but Firefox doesn't offer Add-to-Dock. Use Chrome, Edge, or Safari for the installed experience." },
];

function stepsFor(p: Platform): Steps {
  switch (p) {
    case "ios-safari": return IOS_SAFARI_STEPS;
    case "ios-chrome": return IOS_CHROME_STEPS;
    case "android-chrome": return ANDROID_STEPS;
    case "desktop-chrome": return DESKTOP_CHROME_STEPS;
    case "desktop-safari": return DESKTOP_SAFARI_STEPS;
    case "desktop-firefox": return FIREFOX_STEPS;
    default: return [];
  }
}

function StepList({ steps }: { steps: Steps }) {
  return (
    <ol className="mt-4 space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-4">
          <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[10px] text-ink">{i + 1}</span>
          <div>
            <p className="font-serif text-[15px] text-ink">{s.title}</p>
            <p className="mt-1 font-serif text-[14px] italic text-ink-soft">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const ALL_PLATFORMS: Platform[] = [
  "ios-safari", "android-chrome", "desktop-chrome", "desktop-safari", "ios-chrome", "desktop-firefox",
];

export default function InstallInstructions() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(isStandalone());
  }, []);

  if (standalone) {
    return (
      <div className="mt-6 rounded-xl border border-basil/40 bg-paper-deep/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "#3E5A37" }}>Already installed</p>
        <p className="mt-1 font-serif text-[15px] italic text-ink">You're running FS OS as an installed app. Mic permission should now stick across sessions.</p>
      </div>
    );
  }

  const primary = stepsFor(platform);
  const others = ALL_PLATFORMS.filter((p) => p !== platform && p !== "unknown");

  return (
    <div>
      <section className="mt-6 border-t border-black/10 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          Detected · {platformLabel(platform)}
        </p>
        {primary.length ? (
          <StepList steps={primary} />
        ) : (
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            We couldn't identify your browser. Pick the closest match below.
          </p>
        )}
      </section>

      <section className="mt-10 border-t border-black/10 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Other platforms</p>
        <div className="mt-2 space-y-6">
          {others.map((p) => (
            <details key={p} className="rounded-xl border border-line bg-paper-deep/20 px-4 py-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-ink">{platformLabel(p)}</summary>
              <StepList steps={stepsFor(p)} />
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
