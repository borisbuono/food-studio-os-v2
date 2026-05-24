"use client";
import { useState, useRef } from "react";
import Link from "next/link";

type Panel = { label: string; lines: string[] };

export default function CookMode({ name, panels, backHref }: { name: string; panels: Panel[]; backHref: string }) {
  const [i, setI] = useState(0);
  const startX = useRef<number | null>(null);
  const n = panels.length;
  const go = (d: number) => setI((p) => Math.max(0, Math.min(n - 1, p + d)));
  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    startX.current = null;
  };
  const p = panels[i];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night text-night-ink outline-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }} tabIndex={0}>
      <div className="relative z-20 flex items-center justify-between px-7 pt-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-night-ink/50">{p.label}</span>
        <Link href={backHref} className="font-serif text-[15px] text-night-ink/70">✕ exit</Link>
      </div>

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

      <div className="relative z-20 pb-8 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-night-ink/40">‹ swipe › to move</div>
    </div>
  );
}
