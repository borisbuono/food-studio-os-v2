"use client";

// Small kbd chip primitive. Renders inline next to buttons/actions on lg+;
// hidden on smaller viewports (touch users don't need the hint).
export default function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={
        "hidden lg:inline-flex items-center rounded border border-black/15 bg-paper-deep px-1 font-mono text-[9px] uppercase leading-none text-clay " +
        className
      }
      aria-hidden
    >
      {children}
    </span>
  );
}
