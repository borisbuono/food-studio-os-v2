import Link from "next/link";

export const dynamic = "force-dynamic";

export default function GrowReach() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow · reach</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Coming — Campaigns</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        Compose a campaign from an audience segment (Relationships) plus a commercial offer (Commercials) plus a channel (email, social, SMS) — send via the connected adapter. Klaviyo for email, Buffer for social, Twilio for SMS.
      </p>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Sprint 3 — <span className="text-tomato">MarketingAdapter + Klaviyo + campaign composer</span></p>
    </main>
  );
}
