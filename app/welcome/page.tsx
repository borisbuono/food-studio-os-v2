import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export const metadata: Metadata = {
  title: "Food Studios",
  description: "The chef-built operating system, built by operators for operators.",
};

export const dynamic = "force-dynamic";

// Public FS OS landing. Rendered without the operational sidebar/topbar
// so signed-out visitors see the product, not the entity-scoped app shell.
// If the visitor IS signed in (e.g. they landed here via the callback's
// first-run redirect), forward them to the app — do not show the sign-in
// button; that class of bug caused a sign-in loop for Boris 2026-08-23.
//
// Boris walk 2026-09-10 — the strapline. He flagged the old "chef-built
// operating system" as narrow: this is built by operators, for operators
// (kitchen, dining room, office — every role that touches the day).
// If the visitor arrives with ?role=kitchen|dining|office, the second half
// speaks in the vocabulary of that room.
const ROLE_TAGLINE: Record<string, string> = {
  kitchen: "for the kitchen, by the kitchen",
  dining:  "for the dining room, by the dining room",
  office:  "for the office, by the office",
};

export default async function Welcome({ searchParams }: { searchParams?: { role?: string } }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect("/");

  const role = (searchParams?.role || "").toLowerCase();
  const tagline = ROLE_TAGLINE[role] || "built by operators for operators";

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
        <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-clay">
          the chef-built operating system · {tagline}
        </p>
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
        Ibiza · Bistro Mondo · Taller Sa Penya · Ibiza Food Studio S.L.
      </footer>
    </main>
  );
}
