"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GO_TARGETS, isTypingTarget } from "@/lib/keyboard/shortcuts";

// Global shortcut installer. Sits in the layout.
//
// Handles:
//   ⌘K / Ctrl+K   → open Command-K palette (via 'fs:cmdk:open' event)
//   ⌘Enter        → submit closest form OR fire a 'fs:cmd:submit' event
//                    that consumers can listen for
//   /             → focus first [data-search-input] on the page
//   g h, g f …    → navigate to the mapped route
//   Shift+Esc     → close any open drawer via 'fs:drawer:close' event
//   ?             → open the shortcut help toast

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const gPendingRef = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never swallow inputs — but ⌘K + esc are OK to intercept even in
      // inputs (the palette wants to open, esc wants to blur/close).
      const typing = isTypingTarget(e.target);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("fs:cmdk:open"));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        // Submit closest form. If none, dispatch a soft event that pages
        // like EOD post / triage accept can listen for.
        const tgt = (e.target as HTMLElement) || document.activeElement as HTMLElement;
        const form = tgt?.closest?.("form") as HTMLFormElement | null;
        if (form) {
          e.preventDefault();
          form.requestSubmit();
        } else {
          window.dispatchEvent(new CustomEvent("fs:cmd:submit"));
        }
        return;
      }

      if (e.shiftKey && e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("fs:drawer:close"));
        return;
      }

      if (typing) return;

      if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>("[data-search-input]");
        if (input) { e.preventDefault(); input.focus(); input.select?.(); return; }
      }

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      // g-then-<letter> navigation
      if (gPendingRef.current) {
        window.clearTimeout(gPendingRef.current);
        gPendingRef.current = null;
        const target = GO_TARGETS[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          router.push(target.href);
          return;
        }
      } else if (e.key.toLowerCase() === "g") {
        gPendingRef.current = window.setTimeout(() => { gPendingRef.current = null; }, 900);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // Density preference — set/read a body[data-density] attribute so pages
  // and tables can react in CSS without prop drilling.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const density = localStorage.getItem("fs_density") || "comfortable";
    document.body.setAttribute("data-density", density);
  }, []);

  if (!helpOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-6"
      onClick={() => setHelpOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Keyboard shortcuts</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">Hands on the keys.</h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[11px]">
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">⌘K</dt><dd className="text-ink">Command palette</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">⌘⏎</dt><dd className="text-ink">Submit the current form</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">/</dt><dd className="text-ink">Focus search on this page</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g h</dt><dd className="text-ink">Home</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g f</dt><dd className="text-ink">Finance</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g m</dt><dd className="text-ink">Menu</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g r</dt><dd className="text-ink">Recipes</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g t</dt><dd className="text-ink">Team</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g o</dt><dd className="text-ink">Office</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g b</dt><dd className="text-ink">BOH</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g s</dt><dd className="text-ink">Settings</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g c</dt><dd className="text-ink">Command center</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">g i</dt><dd className="text-ink">Files inbox</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">j / k</dt><dd className="text-ink">Move down / up in lists (opt-in)</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">⇧esc</dt><dd className="text-ink">Close any open drawer</dd>
          <dt className="rounded border border-black/15 bg-paper-deep px-1 text-clay">?</dt><dd className="text-ink">This help</dd>
        </dl>
        <button
          onClick={() => setHelpOpen(false)}
          className="mt-6 rounded border border-black/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:border-ink-soft"
        >
          Close
        </button>
      </div>
    </div>
  );
}
