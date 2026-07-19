"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { flowForRoute } from "@/lib/flows/mapping";
import { pillarForRoute, PILLAR_LABEL, PILLAR_ACCENT, PILLAR_LANDING } from "@/lib/routing/pillar-map";

// The flow-context footer strip.
//
// Pillars #1 addition — now also shows the current PILLAR (FOH / BOH /
// Office). The temporal flow line stays because it's the finer-grained
// context (the arc the current screen lives in — daily-loop, invoice-close,
// menu-sale, guest, team). The pillar line answers "which world am I in?"
export default function FlowStrip() {
  const pathname = usePathname() || "/";
  // Home has its own compass — no strip there.
  if (pathname === "/") return null;
  const f = flowForRoute(pathname);
  const p = pillarForRoute(pathname);
  // Nothing to show if the path is unmapped (e.g. /login, /files landing).
  if (!f && !p) return null;
  const accent = p ? PILLAR_ACCENT[p] : undefined;
  return (
    <div className="mx-auto mt-16 max-w-3xl border-t border-black/10 px-6 py-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
        You are in
        {p ? (
          <>
            <span className="mx-1.5 text-clay">·</span>
            <Link
              href={PILLAR_LANDING[p]}
              className="text-ink hover:underline decoration-black/20 decoration-1 underline-offset-2"
              style={accent ? { borderBottom: "1.5px solid", borderColor: accent, paddingBottom: 1 } : undefined}
            >
              {PILLAR_LABEL[p]}
            </Link>
          </>
        ) : null}
        {f ? (
          <>
            <span className="mx-1.5 text-clay">·</span>
            <span className="text-ink">{f.flowLabel}</span>
            <span className="mx-1.5 text-clay">·</span>
            <span className="text-ink-soft normal-case">{f.step}</span>
          </>
        ) : null}
        <Link href="/?compass=1" className="ml-3 text-ink-soft hover:text-ink normal-case underline decoration-black/20 decoration-1 underline-offset-2">
          ← back to today
        </Link>
      </p>
    </div>
  );
}
