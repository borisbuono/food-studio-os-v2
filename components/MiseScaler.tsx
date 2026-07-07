"use client";
import { useState } from "react";
import Link from "next/link";
import { noEmoji } from "@/lib/text";

type Ing = { name: string; quantity: any; unit: string | null };
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export default function MiseScaler({ ings, portions, recipeId }: { ings: Ing[]; portions: number | null; recipeId: string }) {
  const base = portions && portions > 0 ? portions : null;
  const [n, setN] = useState<number>(base || 1);
  if (!ings.length) return null;
  const factor = base ? n / base : 1;
  const presets = base ? Array.from(new Set([base, base * 2, base * 4])) : [];

  return (
    <section className="pt-14">
      <div className="flex items-baseline justify-between">
        <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Mise{base ? " — for " : ""}{base ? <span className="text-ink"> {n}</span> : ""}</p>
        {base ? <Link href={`/execute/cook/${recipeId}?p=${n}`} className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-tomato">Cook at this size →</Link> : null}
      </div>

      {base ? (
        <div className="mb-3 flex items-center gap-2">
          {presets.map((p) => (
            <button key={p} onClick={() => setN(p)} className={"rounded-full border px-3 h-9 font-sans text-[13px] transition " + (n === p ? "border-tomato bg-tomato/10 text-ink" : "border-black/15 text-ink-soft")}>{p === base ? p + " (base)" : "×" + fmt(p / base)}</button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button aria-label="fewer" onClick={() => setN((v) => Math.max(1, v - 1))} className="h-9 w-9 rounded-full border border-black/15 font-serif text-[18px] text-ink-soft">–</button>
            <span className="w-9 text-center font-serif text-[20px] text-ink">{n}</span>
            <button aria-label="more" onClick={() => setN((v) => v + 1)} className="h-9 w-9 rounded-full border border-black/15 font-serif text-[18px] text-ink-soft">+</button>
          </div>
        </div>
      ) : null}

      <div>
        {ings.map((i, k) => {
          const q = Number(i.quantity);
          const scaled = base && isFinite(q) ? fmt(q * factor) : (i.quantity ?? "");
          return (
            <div key={k} className="flex items-baseline gap-4 border-b border-line py-4 first:border-t">
              <span className="flex-1 font-serif text-[20px] text-ink">{noEmoji(i.name)}</span>
              <span className="font-sans text-[12.5px] tracking-wide text-clay">{scaled} {i.unit ?? ""}</span>
            </div>
          );
        })}
      </div>
      {base && n !== base ? <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">scaled ×{fmt(factor)} from a base of {base}</p> : null}
    </section>
  );
}
