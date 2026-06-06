"use client";
import { useState } from "react";

const RATINGS = ["Poor", "Okay", "Good", "Great", "Exceptional"];

export default function Feedback() {
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <main className="mx-auto max-w-lg px-8 py-20 text-center">
        <h1 className="font-serif text-3xl text-ink">Thank you</h1>
        <p className="mt-3 font-serif text-[17px] text-ink-soft">We read every note — it shapes what we cook next.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg px-8 py-16">
      <h1 className="text-center font-serif text-3xl text-ink">How was it?</h1>
      <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-clay">Bistro Mondo</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {RATINGS.map((r, n) => (
          <button key={n} onClick={() => setRating(n)} className={"rounded-full px-4 py-2 font-sans text-[13px] transition " + (rating === n ? "bg-ember text-[#F7F7F4]" : "border border-black/15 text-ink-soft")}>{r}</button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell us more (optional)" className="mt-6 h-32 w-full rounded-2xl border border-black/15 bg-card p-4 font-serif text-[16px] text-ink outline-none focus:border-ember" />
      <button disabled={rating === null} onClick={() => setSent(true)} className="mt-4 w-full rounded-xl bg-ember px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-50">Send feedback</button>
      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wide text-clay">Preview · routes to the team inbox when connected</p>
    </main>
  );
}
