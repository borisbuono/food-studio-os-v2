"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { flowForRoute } from "@/lib/flows/mapping";

// Architecture v2 — the flow-context footer strip.
// Appears on every non-Home page so the operator always knows WHERE IN THE
// FLOW they are. A subtle mono line, hairline top border.
export default function FlowStrip() {
  const pathname = usePathname() || "/";
  // Home has its own compass — no strip there.
  if (pathname === "/") return null;
  const f = flowForRoute(pathname);
  if (!f) return null;
  return (
    <div className="mx-auto mt-16 max-w-3xl border-t border-black/10 px-6 py-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
        You are in
        <span className="mx-1.5 text-ink">·</span>
        <span className="text-ink">{f.flowLabel}</span>
        <span className="mx-1.5 text-clay">·</span>
        <span className="text-ink-soft normal-case">{f.step}</span>
        <Link href="/" className="ml-3 text-ink-soft hover:text-ink normal-case underline decoration-black/20 decoration-1 underline-offset-2">
          ← back to today
        </Link>
      </p>
    </div>
  );
}
