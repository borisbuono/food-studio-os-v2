"use client";
import { useEffect, useState } from "react";

// PWA #3 (2026-07-28) — persistent "you're offline" badge for standalone
// mode. In the browser we already surface network errors inline; in
// standalone-PWA mode there's no address bar to see the "no signal" state,
// so the operator can be confused about why a save silently failed. This
// keeps a small mono chip at the very top of the frame whenever navigator
// reports offline. Auto-hides when connectivity returns.
export default function PwaOfflineBadge() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="sticky top-0 z-[70] w-full border-b border-tomato/40 bg-tomato/95 py-1 text-center font-mono text-[10px] uppercase tracking-wide text-paper"
      role="status" aria-live="polite">
      Offline · changes won't save until you're back on Wi-Fi
    </div>
  );
}
