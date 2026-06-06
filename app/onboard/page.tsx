"use client";
import { useState } from "react";
import Link from "next/link";

const STEPS = [
  { k: "Venue", blurb: "Name, legal entity, address, service style — the basics of the venue you're bringing on." },
  { k: "Zones", blurb: "Kitchen stations, front of house, dishwash — the physical map work flows through." },
  { k: "Team", blurb: "Invite the team, set roles and languages, assign default stations." },
  { k: "Menu", blurb: "Import or build the menu — dishes, prices, allergens, the knowledge spine." },
  { k: "Suppliers", blurb: "Add providers and their products so ordering and costing work day one." },
  { k: "Go live", blurb: "Review, switch on, and start the daily loop." },
];

export default function Onboard() {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Onboarding · step {i + 1} of {STEPS.length}</p>
      <h1 className="mt-2 font-serif text-4xl text-ink">{STEPS[i].k}</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">{STEPS[i].blurb}</p>

      <div className="mt-6 flex items-center gap-2">
        {STEPS.map((_, k) => <span key={k} className={"h-1.5 rounded-full transition-all " + (k === i ? "w-8 bg-ember" : "w-1.5 bg-black/20")} />)}
      </div>

      <div className="mt-8 flex gap-3">
        {i > 0 ? <button onClick={() => setI(i - 1)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft">Back</button> : null}
        {!last ? (
          <button onClick={() => setI(i + 1)} className="rounded-xl bg-ember px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]">Next</button>
        ) : (
          <Link href="/" className="rounded-xl bg-ember px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]">Finish</Link>
        )}
      </div>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Wizard scaffold · each step wires to real setup as venues are onboarded</p>
    </main>
  );
}
