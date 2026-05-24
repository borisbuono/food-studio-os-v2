"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Handover() {
  const [note, setNote] = useState("");
  useEffect(() => { setNote(localStorage.getItem("fs_handover") || ""); }, []);
  const save = (v: string) => { setNote(v); localStorage.setItem("fs_handover", v); };
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Handover · pass-down</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What the next shift needs to know</h1>
      <textarea
        value={note}
        onChange={(e) => save(e.target.value)}
        placeholder="86'd items, prep left, VIPs tonight, equipment issues, anything the next team should walk into knowing…"
        className="mt-6 h-64 w-full rounded-2xl border border-black/15 bg-card p-4 font-serif text-[16px] leading-relaxed text-ink outline-none focus:border-ember"
      />
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Preview · saved on this device; shared pass-down with sign-in</p>
    </main>
  );
}
