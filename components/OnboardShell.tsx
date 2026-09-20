// components/OnboardShell.tsx — the /onboard wizard chrome.
//
// One small server-friendly wrapper the five step pages render inside.
// Kept intentionally lean: title, sub, dotted progress bar, children.
// No client state, no hooks — every step commits via a server action
// or a route and re-renders on redirect.

import Link from "next/link";

export const TOTAL_STEPS = 5;

export function OnboardShell({
  step,
  eyebrow,
  title,
  sub,
  children,
}: {
  step: number;
  eyebrow?: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl lg:max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
          step {step} of {TOTAL_STEPS}
        </span>
      </div>

      {eyebrow ? (
        <p className="mt-8 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-ink lg:text-5xl">{title}</h1>
      {sub ? (
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">{sub}</p>
      ) : null}

      <div className="mt-6 flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, k) => (
          <span
            key={k}
            className={
              "h-1.5 rounded-full transition-all " +
              (k + 1 === step
                ? "w-8 bg-[color:var(--accent)]"
                : k + 1 < step
                ? "w-4 bg-[color:var(--accent)] opacity-70"
                : "w-1.5 bg-black/20")
            }
          />
        ))}
      </div>

      <div className="mt-10">{children}</div>
    </main>
  );
}

// Reusable input styles for the wizard forms.
export const inputCls =
  "mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink outline-none focus:border-ink";
export const labelCls =
  "font-mono text-[11px] uppercase tracking-wide text-clay";
export const primaryBtn =
  "rounded-xl bg-[color:var(--accent)] px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60";
export const secondaryBtn =
  "rounded-xl border border-black/15 px-5 py-4 font-sans text-[14px] text-ink-soft";
