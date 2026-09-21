import Link from "next/link";

// Shared header for /studio/advisory, /studio/partners, /studio/landlords.
// Carries the Live ↔ Demo toggle and the demo banner so demo rows can never
// be mistaken for live portfolio data.
export function PortfolioHeader({
  title, blurb, path, demo,
}: { title: string; blurb: string; path: string; demo: boolean }) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
        <nav className="flex gap-1 font-mono text-[10px] uppercase tracking-wide">
          <Link
            href={path}
            className={`rounded-full border px-2.5 py-1 ${!demo ? "border-ink text-ink" : "border-line text-clay hover:text-ink"}`}
          >
            Live
          </Link>
          <Link
            href={`${path}?demo=1`}
            className={`rounded-full border px-2.5 py-1 ${demo ? "border-ember text-ember" : "border-line text-clay hover:text-ink"}`}
          >
            Utopia demo
          </Link>
        </nav>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">{title}</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">{blurb}</p>
      {demo ? (
        <p className="mt-4 rounded-lg border border-ember/40 bg-ember/5 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ember">
          Demo data · Utopia sandbox · fictional counterparties, not your portfolio
        </p>
      ) : null}
    </>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "ok" }) {
  const color = tone === "warn" ? "text-ember" : tone === "ok" ? "text-basil" : "text-ink";
  return (
    <div className="rounded-lg border border-black/10 bg-paper/50 p-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className={`mt-1 font-serif text-[26px] leading-none ${color}`}>{value}</p>
      {sub ? <p className="mt-1 font-sans text-[12px] text-ink-soft">{sub}</p> : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">{children}</h2>;
}

export function Pill({ children, tone }: { children: React.ReactNode; tone?: "warn" | "ok" | "muted" }) {
  const c = tone === "warn" ? "#B8552E" : tone === "ok" ? "#3E5A37" : "#7A7A75";
  return (
    <span
      className="inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
      style={{ borderColor: c + "66", color: c, background: c + "14" }}
    >
      {children}
    </span>
  );
}

export function EmptyLive({ what, path }: { what: string; path: string }) {
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center">
      <p className="font-serif italic text-[15px] text-ink-soft">No {what} recorded yet.</p>
      <p className="mt-2 font-sans text-[13px] text-clay">
        Rows land in <code className="font-mono text-[12px]">portfolio_contracts</code> against the counterparty&apos;s entity.{" "}
        <Link href={`${path}?demo=1`} className="underline hover:text-ink">See the Utopia demo</Link>.
      </p>
    </section>
  );
}
