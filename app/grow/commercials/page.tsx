import Link from "next/link";

export const dynamic = "force-dynamic";

export default function GrowCommercials() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow · commercials</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Coming — Commercial offers</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        Happy hours, packages, seasonal specials, wine-club subscriptions, private-event menus. Build the offer, pick items, pick dates, activate — publishes to the guest menu, POS pricing rules and the Reach section.
      </p>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Sprint 2 — <span className="text-tomato">commercial builder + publish to /m</span></p>
    </main>
  );
}
