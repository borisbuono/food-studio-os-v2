import Link from "next/link";

export const dynamic = "force-dynamic";

export default function GrowReputation() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow · reputation</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Coming — Reviews</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        Google, TripAdvisor, TheFork — reviews aggregated here, draft replies via Chef, push responses back through the adapter. Aggregate score per platform on the entity dashboard. Review-inbox merges into <Link href="/grow/inbox" className="underline">/grow/inbox</Link>.
      </p>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Sprint 4 — <span className="text-tomato">ReviewsAdapter + Google Business + inbox merge</span></p>
    </main>
  );
}
