"use client";
import { useEffect, useState } from "react";

export default function ClockIn() {
  const [inAt, setInAt] = useState<string | null>(null);
  useEffect(() => { setInAt(localStorage.getItem("fs_clockin")); }, []);
  const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const clockIn = () => { const t = now(); setInAt(t); localStorage.setItem("fs_clockin", t); };
  const clockOut = () => { setInAt(null); localStorage.removeItem("fs_clockin"); };

  return (
    <div className="rounded-2xl border border-black/10 bg-card p-6">
      <p className="font-sans text-xs font-medium text-ember">Clock-in</p>
      {inAt ? (
        <>
          <p className="mt-2 font-serif text-2xl text-ink">On shift since {inAt}</p>
          <button onClick={clockOut} className="mt-3 rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft transition hover:border-ember/40">Clock out</button>
        </>
      ) : (
        <>
          <p className="mt-2 font-serif text-2xl text-ink">You’re not clocked in</p>
          <button onClick={clockIn} className="mt-3 rounded-xl bg-ember px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]">Clock in</button>
        </>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Preview · GPS-fenced clock-in records to your profile with sign-in</p>
    </div>
  );
}
