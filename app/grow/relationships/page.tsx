import Link from "next/link";

export const dynamic = "force-dynamic";

export default function GrowRelationships() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow · relationships</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Coming — Guest CRM</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        Every guest — who they are, when they last came, what they ordered, what they told us. Segments for the birthday list, the wine club, the private-dining regulars. Built in the OS, so the data stays yours.
      </p>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Sprint 1 — <span className="text-tomato">schema + guest list read view</span></p>
    </main>
  );
}
