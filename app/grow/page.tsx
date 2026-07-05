import Link from "next/link";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/grow/inbox", label: "Inbox", blurb: "Reviews & signals — Google, TripAdvisor, Gmail flags, WhatsApp alerts." },
  { href: "/grow/relationships", label: "Relationships", blurb: "Guest CRM — who they are, when they last came, what they told us." },
  { href: "/grow/commercials", label: "Commercials", blurb: "Happy hours, packages, seasonal specials, wine-club — build, activate, publish." },
  { href: "/grow/reach", label: "Reach", blurb: "Campaigns — audience + offer + channel via Klaviyo, Buffer, Twilio." },
  { href: "/grow/reputation", label: "Reputation", blurb: "Reviews aggregated, draft replies via Chef, push back through the adapter." },
];

export default function GrowHub() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Grow</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Outward-facing</h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">
        The fourth pillar — how we tell people, who they are, what they say back. Relationships, Commercials, Reach, Reputation.
      </p>
      <ul className="mt-8 space-y-3">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="block border-t border-line py-4 transition hover:opacity-70">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-serif text-xl text-ink">{s.label}</h2>
                <span className="font-mono text-[10px] uppercase tracking-wide text-tomato">open ›</span>
              </div>
              <p className="mt-1 font-sans text-[13px] text-ink-soft">{s.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
