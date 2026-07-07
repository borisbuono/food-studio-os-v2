import Link from "next/link";

// Architecture v2 — the consistent 4-tile pillar-landing pattern.
// Each pillar (Develop / Execute / Administrate / Grow) uses exactly 4 tiles.
// Each tile: one big number, one sentence of status, one primary action.
// Visual: hairline top border, editorial typography, per-venue accent.

export function PillarTile({
  href,
  kicker,
  title,
  value,
  status,
  action = "Open →",
}: {
  href: string;
  kicker: string;
  title: string;
  value: string | number;
  status: string;
  action?: string;
}) {
  return (
    <Link href={href} className="group block border-t border-line py-6 transition hover:opacity-80">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{kicker}</p>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-ink">{title}</h2>
        <span className="font-serif text-3xl leading-none text-ink">{value}</span>
      </div>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">{status}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{action}</p>
    </Link>
  );
}

export function PillarHeader({ kicker, title, blurb }: { kicker: string; title: string; blurb: string }) {
  return (
    <>
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{kicker}</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">{title}</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">{blurb}</p>
    </>
  );
}
