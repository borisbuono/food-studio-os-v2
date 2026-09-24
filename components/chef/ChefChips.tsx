"use client";

// ChefChips — Chef v3 Phase 2 S4: predictive idle chips.
//
// 2–3 chips predicted server-side (lib/chef/predict.ts: clock + bookings +
// prep + inbox + delivery weekday + yesterday's turns). They live INSIDE the
// Chef dock band (data-chef-dock, Z.chefDock) — no new floating element:
//   • Phone: one pill left and one right of the control, absolute inside a
//     full-width wrapper so the control stays centred; the middle 96 px is
//     kept clear.
//   • Desktop: up to 3 pills in a wrap row ABOVE the control. The sidebar's
//     identity block sits directly on the 96 px reserve, so instead of
//     hanging the row off the top of the band we grow the reserve itself:
//     body[data-chef-chips="on"] → --chef-dock 140 px on lg (globals.css),
//     which pushes the sidebar padding and the band up together.
// Tap = POST the tap (hit-rate log), then run the utterance as a chip turn.

import { useCallback, useEffect, useRef, useState } from "react";

export type ChefChip = { key: string; label: string; utterance: string };

type Props = { entityId: string; route: string; lang: "es" | "en"; desktop: boolean; visible: boolean; onPick: (c: ChefChip) => void };

const REFRESH_MS = 5 * 60_000;
const DEBOUNCE_MS = 400;

export default function ChefChips({ entityId, route, lang, desktop, visible, onPick }: Props) {
  const [chips, setChips] = useState<ChefChip[]>([]);
  const impression = useRef<string | null>(null);
  const seq = useRef(0);
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!entityId) return;
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    try {
      const r = await fetch("/api/chef/chips?entity=" + encodeURIComponent(entityId) + "&route=" + encodeURIComponent(route || "") + "&lang=" + lang, { cache: "no-store" });
      if (mine !== seq.current) return;
      if (!r.ok) { setChips([]); return; }
      const d = await r.json().catch(() => ({}));
      if (mine !== seq.current) return;
      impression.current = d?.impression_id || null;
      setChips(Array.isArray(d?.chips) ? d.chips.filter((c: any) => c && c.key && c.label && c.utterance).slice(0, 3) : []);
    } catch {
      if (mine === seq.current) setChips([]);
    }
  }, [entityId, route, lang]);

  // On mount + entity/route change (debounced), then every 5 min while
  // visible; a hidden tab pauses and catches up on return.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => { void load(); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [load, visible]);

  useEffect(() => {
    if (!visible) return;
    const tick = () => { if (document.visibilityState === "visible" && Date.now() - lastFetch.current >= REFRESH_MS - 1000) void load(); };
    const iv = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", tick); };
  }, [load, visible]);

  // Desktop: grow the reserve while chips are on screen (see globals.css).
  const shown = visible && chips.length > 0;
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (shown && desktop) document.body.setAttribute("data-chef-chips", "on");
    else document.body.removeAttribute("data-chef-chips");
    return () => { document.body.removeAttribute("data-chef-chips"); };
  }, [shown, desktop]);

  const pick = useCallback((c: ChefChip) => {
    const id = impression.current;
    if (id) {
      try {
        void fetch("/api/chef/chips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ impression_id: id, tapped: c.key }), keepalive: true });
      } catch {}
    }
    onPick(c);
  }, [onPick]);

  if (!shown) return null;

  if (desktop) {
    return (
      <div
        data-chef-chips
        className="pointer-events-none absolute inset-x-0 flex flex-wrap content-end justify-center gap-1 px-3"
        style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))", height: "44px" }}
      >
        {chips.slice(0, 3).map((c) => (
          <button
            key={c.key}
            type="button"
            data-chip={c.key}
            onClick={() => pick(c)}
            className="pointer-events-auto h-5 max-w-full truncate rounded-full border border-line bg-paper px-2.5 font-sans text-[13px] leading-none text-ink shadow-sm active:bg-paper-deep"
            title={c.utterance}
          >
            {c.label}
          </button>
        ))}
      </div>
    );
  }

  const [left, right] = chips;
  const side = "pointer-events-auto absolute flex h-10 max-w-[calc(50%-60px)] items-center truncate rounded-full border border-line bg-paper px-3.5 font-sans text-[15px] text-ink shadow-md active:bg-paper-deep";
  return (
    <div data-chef-chips className="pointer-events-none absolute inset-x-0" style={{ bottom: "calc(36px + env(safe-area-inset-bottom, 0px))", height: "40px" }}>
      {left ? (
        <button type="button" data-chip={left.key} onClick={() => pick(left)} className={side + " left-3"} title={left.utterance}>
          <span className="truncate">{left.label}</span>
        </button>
      ) : null}
      {right ? (
        <button type="button" data-chip={right.key} onClick={() => pick(right)} className={side + " right-3"} title={right.utterance}>
          <span className="truncate">{right.label}</span>
        </button>
      ) : null}
    </div>
  );
}
