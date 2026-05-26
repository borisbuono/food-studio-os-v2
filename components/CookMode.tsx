"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWakeLock, haptic, HAPTIC, useSpeech, useVoiceCommands } from "@/lib/calmtech";

type Panel = { label: string; lines: string[] };

export default function CookMode({ name, panels, backHref }: { name: string; panels: Panel[]; backHref: string }) {
  const [i, setI] = useState(0);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
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
    if (readAloud) { const p = panels[i]; if (p) speak([p.label, ...p.lines].join(". ")); }
    else stop();
  }, [i, readAloud]); // eslint-disable-line react-hooks/exhaustive-deps

  useVoiceCommands({ next: () => go(1), back: () => go(-1), repeat: () => readCurrent() }, voiceOn);

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    startX.current = null;
  };

  const p = panels[i];
  const toggle = "rounded-full border px-3 h-10 flex items-center font-mono text-[10px] uppercase tracking-[0.18em] transition";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night text-night-ink outline-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }} tabIndex={0}>
      <div className="relative z-20 flex items-center justify-between px-7 pt-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-night-ink/50">{p.label}</span>
        <div className="flex items-center gap-2">
          <button aria-label="read this step aloud" onClick={() => { const nv = !readAloud; setReadAloud(nv); haptic(HAPTIC.tap); if (nv) readCurrent(); }} className={toggle + (readAloud ? " border-amber text-amber" : " border-night-ink/25 text-night-ink/70")}>read</button>
          <button aria-label="hands-free voice control" onClick={() => { setVoiceOn((v) => !v); haptic(HAPTIC.tap); }} className={toggle + (voiceOn ? " border-amber text-amber" : " border-night-ink/25 text-night-ink/70")}>voice</button>
          <Link href={backHref} className="ml-1 font-serif text-[15px] text-night-ink/70">exit</Link>
        </div>
      </div>

      {voiceOn && <div className="relative z-20 px-7 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-amber/80">listening — say &ldquo;next&rdquo;, &ldquo;back&rdquo;, &ldquo;repeat&rdquo;</div>}

      <div className="relative z-20 flex gap-1.5 px-7 pt-6">
        {panels.map((_, k) => <i key={k} className={"h-0.5 flex-1 rounded " + (k <= i ? "bg-amber" : "bg-[#322f28]")} />)}
      </div>

      <div className="flex flex-1 flex-col justify-center px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-night-ink/40">{name}</p>
        <div className="mt-6 space-y-4">
          {p.lines.map((l, k) => (
            <p key={k} className="font-serif text-[34px] font-light leading-[1.18] text-night-ink">{l}</p>
          ))}
        </div>
      </div>

      <button aria-label="previous" onClick={() => go(-1)} className="absolute left-0 top-28 bottom-28 z-10 w-1/3" />
      <button aria-label="next" onClick={() => go(1)} className="absolute right-0 top-28 bottom-28 z-10 w-1/3" />

      <div className="relative z-20 flex gap-3 px-7 pb-6">
        <button onClick={() => go(-1)} disabled={i === 0} className="flex-1 rounded-full border border-night-ink/25 py-4 font-serif text-[17px] text-night-ink/80 transition hover:border-night-ink/50 disabled:opacity-25">Back</button>
        <button onClick={() => go(1)} disabled={i === n - 1} className="flex-1 rounded-full bg-amber py-4 font-serif text-[17px] text-night transition hover:opacity-90 disabled:opacity-25">Next</button>
      </div>
      <div className="relative z-20 pb-7 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-night-ink/40">screen stays awake &middot; swipe, tap, or say &ldquo;next&rdquo;</div>
    </div>
  );
}
