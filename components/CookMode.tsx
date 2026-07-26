"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWakeLock, haptic, HAPTIC, useSpeech, useVoiceCommands } from "@/lib/calmtech";

type Panel = { label: string; lines: string[] };

export default function CookMode({ name, panels, backHref }: { name: string; panels: Panel[]; backHref: string }) {
  const [i, setI] = useState(0);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const startX = useRef<number | null>(null);
  const n = panels.length;

  // Keep the screen awake the whole time Cook Mode is open — no sleep mid-prep.
  useWakeLock(true);
  const { speak, stop } = useSpeech();

  const go = useCallback((d: number) => {
    setI((p) => {
      const next = Math.max(0, Math.min(n - 1, p + d));
      if (next !== p) haptic(next === n - 1 ? HAPTIC.done : HAPTIC.tap);
      return next;
    });
  }, [n]);

  const readCurrent = useCallback(() => {
    const p = panels[i];
    if (p) speak([p.label, ...p.lines].join(". "));
  }, [i, panels, speak]);

  // Auto read-aloud when the step changes (when enabled).
  useEffect(() => {
    if (readAloud && !paused) { const p = panels[i]; if (p) speak([p.label, ...p.lines].join(". ")); }
    else stop();
  }, [i, readAloud, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useVoiceCommands({ next: () => go(1), back: () => go(-1), repeat: () => readCurrent() }, voiceOn);

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    startX.current = null;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); go(-1); }
    // Space toggles pause on the auto-read (Boris asked for a keyboard "pause
    // timer" hook — no shipping timer yet, so it pauses the read-aloud which
    // is the closest live loop).
    if (e.code === "Space")     { e.preventDefault(); setPaused((v) => !v); haptic(HAPTIC.tap); }
  };

  const p = panels[i];
  const next = panels[i + 1];
  const toggle = "rounded-full border px-3 h-10 flex items-center font-mono text-[10px] uppercase tracking-[0.18em] transition";

  // The step body renders in a full-bleed layout on mobile (unchanged), and
  // switches to a 60/40 split on lg+ so the next-step preview + ingredients
  // sit alongside the big-serif current step. Boris's arrow-key navigation
  // works on both.

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-night text-night-ink outline-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKey}
      tabIndex={0}
    >
      <div className="relative z-20 flex items-center justify-between px-7 pt-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-night-ink/50">{name}</span>
        <div className="flex items-center gap-2">
          <button aria-label="read this step aloud" onClick={() => { const nv = !readAloud; setReadAloud(nv); haptic(HAPTIC.tap); if (nv) readCurrent(); }} className={toggle + (readAloud ? " border-amber text-amber" : " border-night-ink/25 text-night-ink/70")}>read</button>
          <button aria-label="hands-free voice control" onClick={() => { setVoiceOn((v) => !v); haptic(HAPTIC.tap); }} className={toggle + (voiceOn ? " border-amber text-amber" : " border-night-ink/25 text-night-ink/70")}>voice</button>
          {readAloud ? (
            <button aria-label="pause read-aloud" onClick={() => setPaused((v) => !v)} className={toggle + (paused ? " border-amber text-amber" : " border-night-ink/25 text-night-ink/70")}>
              {paused ? "resume" : "pause"}
            </button>
          ) : null}
          <Link href={backHref} className="ml-1 font-serif text-[15px] text-night-ink/70">exit</Link>
        </div>
      </div>

      {voiceOn && <div className="relative z-20 px-7 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-amber/80">listening — say &ldquo;next&rdquo;, &ldquo;back&rdquo;, &ldquo;repeat&rdquo;</div>}

      <div className="relative z-20 flex gap-1.5 px-7 pt-6">
        {panels.map((_, k) => <i key={k} className={"h-0.5 flex-1 rounded " + (k <= i ? "bg-amber" : "bg-[#322f28]")} />)}
      </div>

      {/* Body — split into two lanes on lg+, single-lane below */}
      <div className="flex flex-1 flex-col justify-center px-8 lg:flex-row lg:items-stretch lg:justify-start lg:px-0 lg:pt-8">
        <div className="lg:w-[60%] lg:px-14 lg:flex lg:flex-col lg:justify-center">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.15em] text-amber">{name} · Cook Mode</p>
          <p className="mb-8 font-mono text-[14px] uppercase tracking-[0.1em] text-amber">{p.label}</p>
          <div className="space-y-4">
            {p.lines.map((l, k) => (
              <p key={k} className="max-w-[780px] font-serif text-[clamp(28px,5vw,44px)] font-normal leading-[1.25] tracking-[-0.6px] text-night-ink">{l}</p>
            ))}
          </div>
        </div>

        {/* Right lane — hidden below lg. Shows either an ingredients panel
           (when the current step IS the mise en place panel — panels[0]
           by convention above) OR the next step preview so the operator
           sees what's coming without a click. */}
        <aside className="hidden lg:flex lg:w-[40%] lg:flex-col lg:gap-6 lg:border-l lg:border-night-ink/10 lg:px-10 lg:py-8 lg:overflow-y-auto">
          {i === 0 && panels[0]?.label.toLowerCase().includes("mise") ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber/80">Full mise for the dish</p>
              <ul className="mt-3 space-y-1.5">
                {panels[0].lines.map((l, k) => (
                  <li key={k} className="font-serif text-[17px] leading-[1.5] text-night-ink/90">{l}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber/80">Next</p>
              {next ? (
                <>
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.15em] text-night-ink/60">{next.label}</p>
                  <div className="mt-2 space-y-2">
                    {next.lines.map((l, k) => (
                      <p key={k} className="font-serif text-[18px] leading-[1.35] text-night-ink/70">{l}</p>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-3 font-serif italic text-[15px] text-night-ink/60">
                  Last panel. Plate up.
                </p>
              )}
            </div>
          )}

          <div className="mt-auto border-t border-night-ink/10 pt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-night-ink/40">Keys</p>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-night-ink/60">
              <li>→ next  ← prev</li>
              <li>space pause read-aloud</li>
              <li>swipe next / prev  (touch)</li>
            </ul>
          </div>
        </aside>
      </div>

      <button aria-label="previous" onClick={() => go(-1)} className="absolute left-0 top-28 bottom-28 z-10 w-1/3 lg:hidden" />
      <button aria-label="next" onClick={() => go(1)} className="absolute right-0 top-28 bottom-28 z-10 w-1/3 lg:hidden" />

      <div className="relative z-20 flex gap-3 px-7 pb-6">
        <button onClick={() => go(-1)} disabled={i === 0} className="flex-1 rounded-full border border-night-ink/25 py-4 font-serif text-[17px] text-night-ink/80 transition hover:border-night-ink/50 disabled:opacity-25">Back</button>
        <button onClick={() => go(1)} disabled={i === n - 1} className="flex-1 rounded-full bg-amber py-4 font-serif text-[17px] text-night transition hover:opacity-90 disabled:opacity-25">Next</button>
      </div>
      <div className="relative z-20 pb-7 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-night-ink/40">screen stays awake &middot; swipe, tap, or say &ldquo;next&rdquo;  <span className="hidden lg:inline">· arrow keys · space to pause read</span></div>
    </div>
  );
}
