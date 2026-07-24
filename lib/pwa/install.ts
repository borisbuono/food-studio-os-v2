// PWA #1 (2026-07-28) — install-state helpers shared by the install prompt,
// the /install page, and the assistant settings surface. Keep them in one
// place so a copy-paste doesn't drift.

// Best-effort standalone detection. iOS exposes navigator.standalone (legacy
// but still the truth on Safari), the rest of the world uses the CSS media
// query. Either wins.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as any;
  if (nav.standalone === true) return true;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.matchMedia?.("(display-mode: minimal-ui)").matches) return true;
    if (window.matchMedia?.("(display-mode: fullscreen)").matches) return true;
  } catch {}
  return false;
}

export type Platform = "ios-safari" | "ios-chrome" | "android-chrome" | "desktop-chrome" | "desktop-safari" | "desktop-firefox" | "unknown";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIOS;
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS/.test(ua);
  const isChrome = /Chrome|CriOS/.test(ua) && !/Edg\/|OPR\//.test(ua);
  const isFirefox = /Firefox/.test(ua) || /FxiOS/.test(ua);
  if (isIOS && isSafari) return "ios-safari";
  if (isIOS) return "ios-chrome"; // any non-Safari iOS browser installs the same way — Share sheet
  if (isAndroid) return "android-chrome";
  if (isMac && isSafari) return "desktop-safari";
  if (isChrome) return "desktop-chrome";
  if (isFirefox) return "desktop-firefox";
  return "unknown";
}

// Human labels for the platform. Kept short and imperative because they land
// inside pretty small nudge strips on Home.
export function platformLabel(p: Platform): string {
  switch (p) {
    case "ios-safari": return "iPhone · Safari";
    case "ios-chrome": return "iPhone · other browser";
    case "android-chrome": return "Android · Chrome";
    case "desktop-chrome": return "Desktop · Chrome / Edge";
    case "desktop-safari": return "Mac · Safari";
    case "desktop-firefox": return "Firefox";
    default: return "Your browser";
  }
}

// True when the platform can install via the Web App Manifest / Add-to-Home
// path we care about. Firefox on desktop can't (yet).
export function canInstall(p: Platform): boolean {
  return p !== "desktop-firefox" && p !== "unknown";
}
