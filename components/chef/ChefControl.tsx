"use client";

// ChefControl — the one control (brief §1). 64 pt circle, five states.
//
//   tap            → start / stop push-to-talk (release while listening = send)
//   hold 400 ms    → camera (only from idle; while listening, holding is just talking)
//   drag up 40 px  → the one-line type field
//
// It is never "open" and has no close button — it has a state. The 24 pt
// hit-slop is the padded wrapper; the visual circle is 64 pt (88 pt while
// listening, with the level ring). Colour: var(--accent) only.

import { useCallback, useEffect, useRef } from "react";
import { t } from "@/lib/i18n";

export type ChefState = "idle" | "listening" | "thinking" | "result" | "confirm" | "error";

export type ChefControlProps = {
  state: ChefState;
  level: number;                 // 0–1 mic level while listening
  onTap: () => void;             // idle → listen, listening → stop & send
  onHold: () => void;            // camera
  onDragUp: () => void;          // type field
  disabled?: boolean;
};

const HOLD_MS = 400;
const DRAG_PX = 40;
const MOVE_TOL = 12;

export default function ChefControl(p: ChefControlProps) {
  const downRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumed = useRef(false); // hold or drag already fired for this press

  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  useEffect(() => () => clearHold(), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (p.disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    consumed.current = false;
    clearHold();
    if (p.state === "idle" || p.state === "result" || p.state === "error") {
      holdTimer.current = setTimeout(() => {
        // Still down, hasn't moved → camera.
        if (downRef.current && !consumed.current) { consumed.current = true; p.onHold(); }
      }, HOLD_MS);
    }
  }, [p]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = downRef.current;
    if (!d || consumed.current) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) > MOVE_TOL || Math.abs(dy) > MOVE_TOL) clearHold();
    if (dy < -DRAG_PX && Math.abs(dx) < DRAG_PX * 1.5) {
      consumed.current = true;
      downRef.current = null;
      p.onDragUp();
    }
  }, [p]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = downRef.current;
    downRef.current = null;
    clearHold();
    if (!d || consumed.current) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) > MOVE_TOL * 2 || Math.abs(dy) > MOVE_TOL * 2) return; // a slip, not a tap
    p.onTap();
  }, [p]);

  const onPointerCancel = useCallback(() => { downRef.current = null; clearHold(); }, []);

  const listening = p.state === "listening";
  const thinking = p.state === "thinking";
  const size = listening ? 88 : 64;
  const ring = listening ? Math.round(4 + p.level * 14) : 0;
  const label =
    listening ? t("chef.listening")
    : thinking ? t("chef.thinking")
    : p.state === "confirm" ? t("chef.confirm_hint")
    : t("chef.tap_to_talk");

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      data-chef-control={p.state}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      disabled={p.disabled}
      className="relative flex items-center justify-center select-none p-6 outline-none"
      style={{ touchAction: "none", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
    >
      {/* level ring */}
      {listening ? (
        <span
          aria-hidden
          className="absolute rounded-full opacity-30"
          style={{
            width: size + ring * 2, height: size + ring * 2,
            background: "var(--accent)", transition: "width 60ms linear, height 60ms linear",
          }}
        />
      ) : null}
      {/* thinking ring */}
      {thinking ? (
        <span
          aria-hidden
          className="absolute rounded-full border-4 border-transparent"
          style={{ width: size + 12, height: size + 12, borderTopColor: "var(--accent)", animation: "fs-chef-spin 900ms linear infinite" }}
        />
      ) : null}
      <span
        className={
          "relative flex items-center justify-center rounded-full shadow-lg shadow-black/25 transition-all duration-150 " +
          (p.state === "error" ? "border-4 bg-paper" : "text-paper")
        }
        style={{
          width: size, height: size,
          background: p.state === "error" ? undefined : "var(--accent)",
          borderColor: p.state === "error" ? "var(--accent)" : undefined,
          color: p.state === "error" ? "var(--accent)" : undefined,
          transform: listening ? "scale(1)" : undefined,
        }}
      >
        {listening ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : p.state === "confirm" ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 3l9 16H3L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          /* Chef mark: a toque */
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M7 10a3.5 3.5 0 0 1 .6-6.9A4.5 4.5 0 0 1 16.4 3a3.5 3.5 0 0 1 .6 7v6H7v-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M7 19h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
