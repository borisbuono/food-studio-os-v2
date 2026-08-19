import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Food Studios",
  description: "The chef-built operating system for restaurants.",
};

export const dynamic = "force-static";

// Public FS OS landing. Rendered without the operational sidebar/topbar
// so signed-out visitors see the product, not the entity-scoped app shell.
// Sidebar hiding is done in app/layout.tsx via a client wrapper that
// checks pathname against the PUBLIC_PATHS list.
export default function Welcome() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
      <header className="mb-12 lg:mb-16">
        <img src="/brand/ifs-mark-black.png" alt="Food Studios" className="h-10 w-auto" />
      </header>

      <section>
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Food Studios OS</p>
        <h1 className="mt-3 font-serif text-[44px] leading-[1.05] text-ink lg:text-[64px]">
          The chef-built<br/>operating system.
        </h1>
        <p className="mt-6 font-serif text-[19px] leading-relaxed text-ink-soft lg:text-[21px]">
          Recipes, service, invoices, GP — one calm surface. Voice-first. Built at the pass, not the spreadsheet.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="inline-flex items-center rounded-xl bg-ink px-6 py-4 font-sans text-[15px] font-medium text-paper transition hover:bg-ink/85"
          >
            Sign in →
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
            Google · magic link · no password
          </span>
        </div>
      </section>

      <footer className="mt-24 border-t border-black/10 pt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
        Ibiza · Bistrot Mondo · Taller Sa Penya · Boris Buono Holdings
      </footer>
    </main>
  );
}
