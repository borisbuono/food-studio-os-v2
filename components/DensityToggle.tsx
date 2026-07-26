"use client";

import { useEffect, useState } from "react";

// Compact / comfortable / spacious. Persisted in localStorage under fs_density
// and mirrored to body[data-density] by KeyboardShortcuts (also on load).
//
// Tables can react in Tailwind via data-attribute selectors:
//   body[data-density=compact]    td { padding: 0.375rem 0.75rem }
//   body[data-density=comfortable] td { padding: 0.75rem 0.75rem }
//   body[data-density=spacious]   td { padding: 1rem 0.75rem }
// (Handled globally in app/globals.css so pages don't need to opt in.)

type Density = "compact" | "comfortable" | "spacious";
const OPTIONS: { key: Density; label: string; hint: string }[] = [
  { key: "compact",     label: "Compact",     hint: "Tight rows · more on screen" },
  { key: "comfortable", label: "Comfortable", hint: "Default balance" },
  { key: "spacious",    label: "Spacious",    hint: "Roomy · easy to scan" },
];

export default function DensityToggle() {
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    const cur = (localStorage.getItem("fs_density") as Density | null) || "comfortable";
    setDensity(cur);
    document.body.setAttribute("data-density", cur);
  }, []);

  const set = (d: Density) => {
    setDensity(d);
    localStorage.setItem("fs_density", d);
    document.body.setAttribute("data-density", d);
  };

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Table density</p>
      <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
        Applies globally to every table on lg+ viewports. Phones stay comfortable regardless.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => {
          const active = density === o.key;
          return (
            <button
              key={o.key}
              onClick={() => set(o.key)}
              className={
                "rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition " +
                (active
                  ? "border-transparent text-white"
                  : "border-black/10 text-ink-soft hover:border-ink-soft")
              }
              style={active ? { background: "var(--accent)" } : undefined}
              title={o.hint}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
