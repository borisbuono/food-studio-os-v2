import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NewCampaign() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow · reach · new campaign</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Coming — Composer</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        Pick an audience segment from Relationships, drop in a commercial offer, write the note, hit send. Wix API takes it from there.
      </p>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
        Sprint 4 — <span className="text-tomato">Composer + audience picker + Wix POST /email-marketing/v1/campaigns</span>
      </p>
    </main>
  );
}
