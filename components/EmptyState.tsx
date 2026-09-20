// components/EmptyState.tsx — the "no data yet" pattern.
//
// Every page that shows a table / dashboard / feed of some kind should
// render <EmptyState> instead of a bare "no rows" line when the query
// comes back empty. Directs the operator to a relevant onboarding step
// (or a CTA link they can act on) instead of a broken UI.
//
// Reused across Studio Money, Overview, Recipes, etc. Kept dependency-free
// so it can be dropped into a server component without a hydration cost.

import Link from "next/link";

export function EmptyState({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-black/15 bg-transparent px-6 py-10 text-center">
      {eyebrow ? (
        <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
          {eyebrow}
        </p>
      ) : null}
      <p className="mt-2 font-serif text-[22px] leading-snug text-ink">{title}</p>
      {body ? (
        <p className="mt-3 font-serif text-[15px] leading-relaxed text-ink-soft">{body}</p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mt-6 inline-block rounded-xl bg-[color:var(--accent)] px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
