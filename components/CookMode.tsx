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
    <div
      className="fixed inset-0 z-50 flex flex-col bg-paper outline-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }}
      tabIndex={0}
    >
      <div className="relative z-20 flex items-center justify-between px-6 pt-6">
        <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{p.label}</span>
        <Link href={backHref} className="font-sans text-sm text-ink-soft">close</Link>
      </div>

      <div className="flex flex-1 flex-col justify-center px-8">
        <p className="font-serif text-sm text-clay">{name}</p>
        <div className="mt-4 space-y-3">
          {p.lines.map((l, k) => (
            <p key={k} className="font-serif text-[26px] leading-snug text-ink">{l}</p>
          ))}
        </div>
      </div>

      <button aria-label="previous" onClick={() => go(-1)} className="absolute left-0 top-20 bottom-24 z-10 w-1/3" />
      <button aria-label="next" onClick={() => go(1)} className="absolute right-0 top-20 bottom-24 z-10 w-1/3" />

      <div className="relative z-20 flex items-center justify-center gap-2 pb-10">
        {panels.map((_, k) => (
          <span key={k} className={"h-1.5 rounded-full transition-all " + (k === i ? "w-8 bg-ember" : "w-1.5 bg-black/20")} />
        ))}
      </div>
    </div>
  );
}
