// TabNav — text tabs for a merged screen (slim OS slices 2–4, 2026-09-26).
//
// The critic's merge table folds sibling screens into ONE landing per verb:
// the folded screen keeps its component, loses its route, and is reached as
// `?tab=<key>` on the survivor (lib/routing/retired.ts 308s the old address
// here). Weight marks the active tab — no colour, no underline accent; a
// hairline below the row, as everywhere else in the rail and the dock.
//
// Server-safe: plain <Link>s, no state. Any extra query the survivor needs
// (`?entity=`, `?house=`) is carried by `keep`.

import Link from "next/link";

export type Tab = { key: string; label: string; count?: number | null };

type Props = {
  base: string;               // pathname of the survivor
  tabs: Tab[];
  active: string;
  param?: string;             // query key, default "tab"
  keep?: Record<string, string | undefined | null>;
  className?: string;
};

export default function TabNav({ base, tabs, active, param = "tab", keep, className }: Props) {
  const href = (key: string, i: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep || {})) if (v) q.set(k, v);
    if (i > 0) q.set(param, key);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <nav aria-label="Sections" className={`flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-black/10 pb-2 ${className || ""}`}>
      {tabs.map((t, i) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={href(t.key, i)}
            aria-current={on ? "page" : undefined}
            className={`font-sans text-[14px] leading-6 ${on ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}
          >
            {t.label}
            {t.count != null && t.count > 0 ? <span className="ml-1 font-mono text-[11px] tabular-nums text-ink-soft">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Pick the active tab from searchParams; the first tab is the default.
export function pickTab(tabs: Tab[], raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return tabs.some((t) => t.key === v) ? (v as string) : tabs[0].key;
}

// Shared shell for a merged landing: title row + tabs + the folded screen.
// The folded screens keep their own <main> with its padding; `[&>main]:pt-2`
// trims the doubled top gap without touching them.
export function MergedShell({ eyebrow, title, tabs, children, wide }: {
  eyebrow?: string; title: string; tabs: React.ReactNode; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className={`mx-auto ${wide ? "max-w-[1400px]" : "max-w-xl lg:max-w-4xl"} px-6 pt-8`}>
      {eyebrow ? <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{eyebrow}</p> : null}
      <h1 className="mt-1 font-serif text-3xl text-ink">{title}</h1>
      <div className="mt-5">{tabs}</div>
      <div className="[&>main]:px-0 [&>main]:pt-4">{children}</div>
    </div>
  );
}
